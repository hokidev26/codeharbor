package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type fsEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

func (s *Server) fsBrowse(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolveFSPathForRequest(r, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	items := make([]fsEntry, 0, len(entries))
	for _, entry := range entries {
		childPath := filepath.Join(path, entry.Name())
		resolvedChild, err := s.resolveFSPathForRequest(r, childPath)
		if err != nil { // Do not expose metadata for symlinks outside the project boundary.
			continue
		}
		info, err := os.Stat(resolvedChild)
		if err != nil {
			continue
		}
		items = append(items, fsEntry{Name: entry.Name(), Path: childPath, IsDir: info.IsDir(), Size: info.Size(), ModTime: info.ModTime().UTC().Format(http.TimeFormat)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "entries": items})
}

type fsDirectoryShortcut struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func (s *Server) fsDirectories(w http.ResponseWriter, r *http.Request) {
	defaultProjectDir := s.configSnapshot().Paths.DefaultProjectDir
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		path = defaultDirectoryRoot(defaultProjectDir)
	}
	var abs string
	var err error
	capabilities := s.capabilitiesForRequest(r)
	if capabilities.FilesystemScope == "project" {
		abs, err = s.resolveFSPathForRequest(r, path)
	} else {
		abs, err = s.resolveFSPathForRequest(r, path)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a directory")
		return
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	items := make([]fsEntry, 0, len(entries))
	remote := capabilities.FilesystemScope == "project"
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		childPath := filepath.Join(abs, entry.Name())
		if remote {
			resolved, err := s.resolveFSPathForRequest(r, childPath)
			if err != nil {
				continue
			}
			childPath = resolved
		}
		info, err := os.Stat(childPath)
		if err != nil || !info.IsDir() {
			continue
		}
		items = append(items, fsEntry{Name: entry.Name(), Path: childPath, IsDir: true, Size: info.Size(), ModTime: info.ModTime().UTC().Format(http.TimeFormat)})
	}
	sort.Slice(items, func(i, j int) bool { return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name) })
	parent := ""
	if parentDir := filepath.Dir(abs); parentDir != abs {
		if !remote {
			parent = parentDir
		} else if resolvedParent, err := s.resolveFSPathForRequest(r, parentDir); err == nil {
			parent = resolvedParent
		}
	}
	shortcuts := directoryShortcuts(defaultProjectDir)
	if remote {
		base, _ := s.resolveFSPathForRequest(r, "")
		shortcuts = []fsDirectoryShortcut{{Name: "Projects", Path: base}}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":      abs,
		"name":      filepath.Base(abs),
		"parent":    parent,
		"entries":   items,
		"shortcuts": shortcuts,
	})
}

func (s *Server) fsNativeDirectory(w http.ResponseWriter, r *http.Request) {
	capabilities := s.capabilitiesForRequest(r)
	if s.remoteAccessGateRequired(r) && !capabilities.NativePickerAllowed {
		writeError(w, http.StatusForbidden, "native directory selection requires a full remote session and policy approval")
		return
	}
	if runtime.GOOS != "darwin" {
		writeError(w, http.StatusNotImplemented, "当前系统暂不支持原生资料夹选择器，请使用内置目录浏览器")
		return
	}
	defaultProjectDir := s.configSnapshot().Paths.DefaultProjectDir
	defaultPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if defaultPath == "" {
		defaultPath = defaultDirectoryRoot(defaultProjectDir)
	}
	if abs, err := filepath.Abs(defaultPath); err == nil {
		if info, statErr := os.Stat(abs); statErr == nil && info.IsDir() {
			defaultPath = abs
		} else {
			defaultPath = defaultDirectoryRoot(defaultProjectDir)
		}
	}

	script := `set chosenFolder to choose folder with prompt "选择 Autoto 工作资料夹"`
	if defaultPath != "" {
		script = `set defaultFolder to POSIX file ` + appleScriptString(defaultPath) + ` as alias
set chosenFolder to choose folder with prompt "选择 Autoto 工作资料夹" default location defaultFolder`
	}
	script += "\nPOSIX path of chosenFolder"

	output, err := exec.CommandContext(r.Context(), "osascript", "-e", script).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if strings.Contains(message, "User canceled") || strings.Contains(message, "-128") {
			writeJSON(w, http.StatusOK, map[string]any{"canceled": true})
			return
		}
		if message == "" {
			message = err.Error()
		}
		writeError(w, http.StatusInternalServerError, "原生资料夹选择器打开失败："+message)
		return
	}
	path := filepath.Clean(strings.TrimSpace(string(output)))
	if path == "." || path == "" {
		writeError(w, http.StatusInternalServerError, "原生资料夹选择器没有返回路径")
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "path must be a directory")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "name": filepath.Base(path), "canceled": false})
}

func appleScriptString(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func defaultDirectoryRoot(defaultProjectDir string) string {
	if defaultProjectDir != "" {
		if info, err := os.Stat(defaultProjectDir); err == nil && info.IsDir() {
			return defaultProjectDir
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return string(filepath.Separator)
}

func directoryShortcuts(defaultProjectDir string) []fsDirectoryShortcut {
	shortcuts := make([]fsDirectoryShortcut, 0, 6)
	add := func(name, path string) {
		if path == "" {
			return
		}
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			shortcuts = append(shortcuts, fsDirectoryShortcut{Name: name, Path: path})
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		add("Home", home)
		add("Desktop", filepath.Join(home, "Desktop"))
		add("Downloads", filepath.Join(home, "Downloads"))
		add("Documents", filepath.Join(home, "Documents"))
	}
	add("Projects", defaultProjectDir)
	add("Root", string(filepath.Separator))
	return shortcuts
}

func (s *Server) fsPreview(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolveFSPathForRequest(r, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is a directory")
		return
	}
	const maxPreviewBytes = 256 * 1024
	file, err := os.Open(path)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPreviewBytes+1))
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	truncated := len(data) > maxPreviewBytes
	if truncated {
		data = data[:maxPreviewBytes]
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "size": info.Size(), "truncated": truncated, "text": string(data)})
}

type mkdirRequest struct {
	Path string `json:"path"`
}

func (s *Server) fsMkdir(w http.ResponseWriter, r *http.Request) {
	var req mkdirRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.resolveFSPathForRequest(r, req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path})
}

func (s *Server) fsBasePath() string {
	cfg := s.configSnapshot()
	base := cfg.Paths.DefaultProjectDir
	if base == "" {
		base = cfg.Paths.HomeDir
	}
	return base
}

// resolveFSPath checks physical containment after resolving symlinks. For paths
// that do not exist yet, it resolves the nearest existing ancestor so mkdir and
// write-adjacent operations cannot escape through an in-project symlink.
func (s *Server) resolveFSPath(input string) (string, error) {
	baseAbs, err := filepath.Abs(s.fsBasePath())
	if err != nil {
		return "", err
	}
	baseReal, err := resolvePhysicalFSPath(baseAbs)
	if err != nil {
		return "", err
	}
	path := input
	if path == "" {
		path = baseReal
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(baseReal, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	resolved, err := resolvePhysicalFSPath(abs)
	if err != nil {
		return "", err
	}
	if !fsPathWithin(baseReal, resolved) {
		return "", errors.New("path escapes default project directory")
	}
	return resolved, nil
}

func resolvePhysicalFSPath(path string) (string, error) {
	path = filepath.Clean(path)
	missing := make([]string, 0)
	for {
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", err
		}
		missing = append(missing, filepath.Base(path))
		path = parent
	}
}

func fsPathWithin(base, path string) bool {
	rel, err := filepath.Rel(base, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func statusFromFSError(err error) int {
	if errors.Is(err, os.ErrNotExist) {
		return http.StatusNotFound
	}
	if errors.Is(err, os.ErrPermission) {
		return http.StatusForbidden
	}
	return http.StatusInternalServerError
}
