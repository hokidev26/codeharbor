package workspacefs

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	MaxTreeEntries = 500
	MaxFileBytes   = 1 << 20
	PreviewBytes   = 256 << 10
)

var (
	ErrInvalidPath = errors.New("invalid workspace path")
	ErrForbidden   = errors.New("workspace access forbidden")
	ErrNotFound    = errors.New("workspace path not found")
	ErrConflict    = errors.New("workspace file conflict")
	ErrTooLarge    = errors.New("workspace file too large")
	ErrBinary      = errors.New("workspace file is binary")
)

type FS struct {
	rootPath string
	realRoot string
}

type Entry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	ModTime  string `json:"modTime"`
	Editable bool   `json:"editable"`
}

type Tree struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

type File struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	ModTime   string `json:"modTime"`
	Content   string `json:"content"`
	Editable  bool   `json:"editable"`
	ReadOnly  bool   `json:"readOnly"`
	Truncated bool   `json:"truncated"`
}

type WriteResult struct {
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

func New(root string) (*FS, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("%w: agent cwd is required", ErrInvalidPath)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPath, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, classifyPathError(err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%w: agent cwd is not a directory", ErrInvalidPath)
	}
	realRoot, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, classifyPathError(err)
	}
	realRoot, err = filepath.Abs(realRoot)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPath, err)
	}
	realInfo, err := os.Stat(realRoot)
	if err != nil {
		return nil, classifyPathError(err)
	}
	if !realInfo.IsDir() {
		return nil, fmt.Errorf("%w: agent cwd is not a directory", ErrInvalidPath)
	}
	return &FS{rootPath: filepath.Clean(abs), realRoot: filepath.Clean(realRoot)}, nil
}

func NormalizePath(input string, allowRoot bool) (string, error) {
	if strings.ContainsRune(input, '\x00') || strings.Contains(input, `\`) {
		return "", fmt.Errorf("%w: path contains an invalid character", ErrInvalidPath)
	}
	if input == "" {
		if allowRoot {
			return "", nil
		}
		return "", fmt.Errorf("%w: path is required", ErrInvalidPath)
	}
	if strings.HasPrefix(input, "/") || filepath.IsAbs(input) || filepath.VolumeName(input) != "" {
		return "", fmt.Errorf("%w: path must be relative", ErrInvalidPath)
	}
	clean := path.Clean(input)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("%w: path escapes workspace", ErrInvalidPath)
	}
	if clean != input {
		return "", fmt.Errorf("%w: path must be normalized", ErrInvalidPath)
	}
	return clean, nil
}

func (fs *FS) Tree(relativePath string) (Tree, error) {
	rel, err := NormalizePath(relativePath, true)
	if err != nil {
		return Tree{}, err
	}
	resolved, info, err := fs.resolveExisting(rel)
	if err != nil {
		return Tree{}, err
	}
	if !info.IsDir() {
		return Tree{}, fmt.Errorf("%w: tree path is not a directory", ErrInvalidPath)
	}
	entries, err := os.ReadDir(resolved)
	if err != nil {
		return Tree{}, classifyPathError(err)
	}
	items := make([]Entry, 0, min(len(entries), MaxTreeEntries))
	for _, dirEntry := range entries {
		name := dirEntry.Name()
		childRel := name
		if rel != "" {
			childRel = path.Join(rel, name)
		}
		if IsSensitivePath(childRel) {
			continue
		}
		childResolved, childInfo, resolveErr := fs.resolveExisting(childRel)
		if resolveErr != nil {
			continue
		}
		if childInfo.IsDir() && isHeavyDirectory(name) {
			continue
		}
		if !childInfo.IsDir() && !childInfo.Mode().IsRegular() {
			continue
		}
		editable := false
		if childInfo.Mode().IsRegular() && childInfo.Size() <= PreviewBytes {
			editable = fileLooksText(childResolved)
		}
		items = append(items, Entry{
			Name:     name,
			Path:     childRel,
			IsDir:    childInfo.IsDir(),
			Size:     childInfo.Size(),
			ModTime:  formatModTime(childInfo.ModTime()),
			Editable: editable,
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		left := strings.ToLower(items[i].Name)
		right := strings.ToLower(items[j].Name)
		if left != right {
			return left < right
		}
		return items[i].Name < items[j].Name
	})
	if len(items) > MaxTreeEntries {
		items = items[:MaxTreeEntries]
	}
	return Tree{Path: rel, Entries: items}, nil
}

func (fs *FS) ReadFile(relativePath string) (File, error) {
	rel, err := NormalizePath(relativePath, false)
	if err != nil {
		return File{}, err
	}
	if IsSensitivePath(rel) {
		return File{}, fmt.Errorf("%w: sensitive files are not available", ErrForbidden)
	}
	resolved, info, err := fs.resolveExisting(rel)
	if err != nil {
		return File{}, err
	}
	if !info.Mode().IsRegular() {
		return File{}, fmt.Errorf("%w: path is not a regular file", ErrInvalidPath)
	}
	if info.Size() > MaxFileBytes {
		return File{}, fmt.Errorf("%w: maximum size is %d bytes", ErrTooLarge, MaxFileBytes)
	}
	file, err := os.Open(resolved)
	if err != nil {
		return File{}, classifyPathError(err)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return File{}, classifyPathError(readErr)
	}
	if closeErr != nil {
		return File{}, closeErr
	}
	if len(data) > MaxFileBytes {
		return File{}, fmt.Errorf("%w: maximum size is %d bytes", ErrTooLarge, MaxFileBytes)
	}
	if !isText(data) {
		return File{}, ErrBinary
	}
	truncated := len(data) > PreviewBytes
	content := data
	if truncated {
		content = validUTF8Prefix(data[:PreviewBytes])
	}
	readOnly := truncated
	return File{
		Name:      path.Base(rel),
		Path:      rel,
		Size:      int64(len(data)),
		ModTime:   formatModTime(info.ModTime()),
		Content:   string(content),
		Editable:  !readOnly,
		ReadOnly:  readOnly,
		Truncated: truncated,
	}, nil
}

func (fs *FS) WriteFile(relativePath string, content []byte, expectedModTime string) (WriteResult, error) {
	rel, err := NormalizePath(relativePath, false)
	if err != nil {
		return WriteResult{}, err
	}
	if IsSensitivePath(rel) {
		return WriteResult{}, fmt.Errorf("%w: sensitive files cannot be changed", ErrForbidden)
	}
	if len(content) > MaxFileBytes {
		return WriteResult{}, fmt.Errorf("%w: maximum size is %d bytes", ErrTooLarge, MaxFileBytes)
	}
	if !isText(content) {
		return WriteResult{}, ErrBinary
	}

	target, existingInfo, existed, err := fs.resolveWriteTarget(rel)
	if err != nil {
		return WriteResult{}, err
	}
	if existed && !existingInfo.Mode().IsRegular() {
		return WriteResult{}, fmt.Errorf("%w: path is not a regular file", ErrInvalidPath)
	}
	if expectedModTime != "" {
		if !existed || formatModTime(existingInfo.ModTime()) != expectedModTime {
			return WriteResult{}, fmt.Errorf("%w: file changed since it was read", ErrConflict)
		}
	}

	mode := os.FileMode(0o644)
	if existed {
		mode = existingInfo.Mode() & (os.ModePerm | os.ModeSetuid | os.ModeSetgid | os.ModeSticky)
	}
	parent := filepath.Dir(target)
	temp, err := os.CreateTemp(parent, ".autoto-workspace-*")
	if err != nil {
		return WriteResult{}, classifyPathError(err)
	}
	tempName := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempName)
	}
	if err := temp.Chmod(mode); err != nil {
		cleanup()
		return WriteResult{}, classifyPathError(err)
	}
	if _, err := temp.Write(content); err != nil {
		cleanup()
		return WriteResult{}, classifyPathError(err)
	}
	if err := temp.Sync(); err != nil {
		cleanup()
		return WriteResult{}, classifyPathError(err)
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempName)
		return WriteResult{}, classifyPathError(err)
	}

	checkedTarget, currentInfo, currentlyExists, err := fs.resolveWriteTarget(rel)
	if err != nil {
		_ = os.Remove(tempName)
		return WriteResult{}, err
	}
	if checkedTarget != target || currentlyExists != existed {
		_ = os.Remove(tempName)
		return WriteResult{}, fmt.Errorf("%w: file changed during save", ErrConflict)
	}
	if expectedModTime != "" && (!currentlyExists || formatModTime(currentInfo.ModTime()) != expectedModTime) {
		_ = os.Remove(tempName)
		return WriteResult{}, fmt.Errorf("%w: file changed during save", ErrConflict)
	}
	if err := os.Rename(tempName, target); err != nil {
		_ = os.Remove(tempName)
		return WriteResult{}, classifyPathError(err)
	}
	if dir, openErr := os.Open(parent); openErr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	info, err := os.Stat(target)
	if err != nil {
		return WriteResult{}, classifyPathError(err)
	}
	return WriteResult{Path: rel, Size: info.Size(), ModTime: formatModTime(info.ModTime())}, nil
}

func (fs *FS) resolveExisting(rel string) (string, os.FileInfo, error) {
	candidate := fs.join(rel)
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", nil, classifyPathError(err)
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrInvalidPath, err)
	}
	if !fs.contains(resolved) {
		return "", nil, fmt.Errorf("%w: symbolic link escapes workspace", ErrForbidden)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", nil, classifyPathError(err)
	}
	return filepath.Clean(resolved), info, nil
}

func (fs *FS) resolveWriteTarget(rel string) (string, os.FileInfo, bool, error) {
	candidate := fs.join(rel)
	if _, err := os.Lstat(candidate); err == nil {
		resolved, info, resolveErr := fs.resolveExisting(rel)
		return resolved, info, true, resolveErr
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", nil, false, classifyPathError(err)
	}

	ancestor := filepath.Dir(candidate)
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			break
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", nil, false, classifyPathError(err)
		}
		next := filepath.Dir(ancestor)
		if next == ancestor {
			return "", nil, false, ErrNotFound
		}
		ancestor = next
	}
	realAncestor, err := filepath.EvalSymlinks(ancestor)
	if err != nil {
		return "", nil, false, classifyPathError(err)
	}
	realAncestor, err = filepath.Abs(realAncestor)
	if err != nil {
		return "", nil, false, fmt.Errorf("%w: %v", ErrInvalidPath, err)
	}
	if !fs.contains(realAncestor) {
		return "", nil, false, fmt.Errorf("%w: symbolic link ancestor escapes workspace", ErrForbidden)
	}

	parentRel, err := filepath.Rel(ancestor, filepath.Dir(candidate))
	if err != nil {
		return "", nil, false, fmt.Errorf("%w: %v", ErrInvalidPath, err)
	}
	resolvedParent := filepath.Join(realAncestor, parentRel)
	parentInfo, err := os.Stat(resolvedParent)
	if err != nil {
		return "", nil, false, classifyPathError(err)
	}
	if !parentInfo.IsDir() {
		return "", nil, false, fmt.Errorf("%w: parent is not a directory", ErrInvalidPath)
	}
	if !fs.contains(resolvedParent) {
		return "", nil, false, fmt.Errorf("%w: parent escapes workspace", ErrForbidden)
	}
	return filepath.Join(resolvedParent, filepath.Base(candidate)), nil, false, nil
}

func (fs *FS) join(rel string) string {
	if rel == "" {
		return fs.rootPath
	}
	return filepath.Join(fs.rootPath, filepath.FromSlash(rel))
}

func (fs *FS) contains(candidate string) bool {
	rel, err := filepath.Rel(fs.realRoot, filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func IsSensitivePath(relativePath string) bool {
	for _, component := range strings.Split(strings.ToLower(relativePath), "/") {
		if isSensitiveName(component) {
			return true
		}
	}
	return false
}

func isSensitiveName(name string) bool {
	if name == ".env" || strings.HasPrefix(name, ".env.") {
		return true
	}
	if name == "credentials" || strings.HasPrefix(name, "credentials.") || name == "credential" || strings.HasPrefix(name, "credential.") {
		return true
	}
	switch name {
	case ".npmrc", ".pypirc", ".netrc", "auth.json", "secrets.json", "secret.json", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519":
		return true
	}
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".pem", ".key", ".p12", ".pfx":
		return true
	default:
		return false
	}
}

func isHeavyDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "target", ".next", ".nuxt", "coverage", "out", "bin", "obj":
		return true
	default:
		return false
	}
}

func fileLooksText(filename string) bool {
	file, err := os.Open(filename)
	if err != nil {
		return false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 8<<10))
	return err == nil && isText(data)
}

func isText(data []byte) bool {
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return false
	}
	for _, b := range data {
		if b < 0x20 && b != '\n' && b != '\r' && b != '\t' && b != '\f' && b != '\b' {
			return false
		}
	}
	return true
}

func validUTF8Prefix(data []byte) []byte {
	for len(data) > 0 && !utf8.Valid(data) {
		data = data[:len(data)-1]
	}
	return data
}

func formatModTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func classifyPathError(err error) error {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, os.ErrPermission), errors.Is(err, syscall.ELOOP):
		return fmt.Errorf("%w: %v", ErrForbidden, err)
	case errors.Is(err, syscall.ENOTDIR), errors.Is(err, syscall.ENAMETOOLONG):
		return fmt.Errorf("%w: %v", ErrInvalidPath, err)
	default:
		return err
	}
}
