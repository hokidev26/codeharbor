package gitsnapshot

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type StatusEntry struct {
	Path           string
	IndexStatus    string
	WorktreeStatus string
	Untracked      bool
}

func ParsePorcelainV1NoRenames(out string) ([]StatusEntry, error) {
	parts := strings.Split(out, "\x00")
	entries := make([]StatusEntry, 0, len(parts))
	for _, record := range parts {
		if record == "" {
			continue
		}
		if len(record) < 4 {
			return nil, fmt.Errorf("invalid git status record")
		}
		entry := StatusEntry{
			Path:           filepath.ToSlash(record[3:]),
			IndexStatus:    record[:1],
			WorktreeStatus: record[1:2],
		}
		if entry.Path == "" {
			return nil, fmt.Errorf("git status reported an empty path")
		}
		entry.Untracked = entry.IndexStatus == "?" && entry.WorktreeStatus == "?"
		entries = append(entries, entry)
	}
	return entries, nil
}

func IndexFingerprint(raw string) string {
	if raw == "" {
		return "missing"
	}
	return FingerprintData("index", 0, []byte(raw))
}

func WorktreeFingerprint(repoRoot, relativePath string) (string, error) {
	path, err := Path(repoRoot, relativePath)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return "missing", nil
	}
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err != nil {
			return "", err
		}
		return FingerprintData("symlink", info.Mode(), []byte(target)), nil
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("checkpoint path is not a regular file or symlink: %s", relativePath)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return FingerprintReader("file", info.Mode(), file)
}

func FingerprintReader(kind string, mode os.FileMode, reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return fingerprintPrefix(kind, mode) + fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func FingerprintData(kind string, mode os.FileMode, data []byte) string {
	hash := sha256.New()
	_, _ = hash.Write(data)
	return fingerprintPrefix(kind, mode) + fmt.Sprintf("%x", hash.Sum(nil))
}

func Path(repoRoot, relativePath string) (string, error) {
	relativePath = filepath.Clean(filepath.FromSlash(strings.TrimSpace(relativePath)))
	if relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) || filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("git checkpoint path escapes repository: %q", relativePath)
	}
	path := filepath.Join(repoRoot, relativePath)
	resolved, err := filepath.Rel(repoRoot, path)
	if err != nil || resolved == ".." || strings.HasPrefix(resolved, ".."+string(filepath.Separator)) || filepath.IsAbs(resolved) {
		return "", fmt.Errorf("git checkpoint path escapes repository: %q", relativePath)
	}
	return path, nil
}

func fingerprintPrefix(kind string, mode os.FileMode) string {
	return fmt.Sprintf("%s:type=%#o:perm=%#o:", kind, uint32(mode.Type()), uint32(mode.Perm()))
}
