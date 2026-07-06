package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
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
	path, err := s.resolveFSPath(r.URL.Query().Get("path"))
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
		info, err := entry.Info()
		if err != nil {
			continue
		}
		childPath := filepath.Join(path, entry.Name())
		items = append(items, fsEntry{Name: entry.Name(), Path: childPath, IsDir: entry.IsDir(), Size: info.Size(), ModTime: info.ModTime().UTC().Format(http.TimeFormat)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "entries": items})
}

type fsDirectoryShortcut struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func (s *Server) fsDirectories(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		path = defaultDirectoryRoot(s.cfg.Paths.DefaultProjectDir)
	}
	abs, err := filepath.Abs(path)
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
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		childPath := filepath.Join(abs, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, fsEntry{Name: entry.Name(), Path: childPath, IsDir: true, Size: info.Size(), ModTime: info.ModTime().UTC().Format(http.TimeFormat)})
	}
	sort.Slice(items, func(i, j int) bool { return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name) })
	parent := ""
	if parentDir := filepath.Dir(abs); parentDir != abs {
		parent = parentDir
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":      abs,
		"parent":    parent,
		"entries":   items,
		"shortcuts": directoryShortcuts(s.cfg.Paths.DefaultProjectDir),
	})
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
	path, err := s.resolveFSPath(r.URL.Query().Get("path"))
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
	data, err := os.ReadFile(path)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	truncated := false
	if len(data) > maxPreviewBytes {
		data = data[:maxPreviewBytes]
		truncated = true
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
	path, err := s.resolveFSPath(req.Path)
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

func (s *Server) resolveFSPath(input string) (string, error) {
	base := s.cfg.Paths.DefaultProjectDir
	if base == "" {
		base = s.cfg.Paths.HomeDir
	}
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	path := input
	if path == "" {
		path = baseAbs
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(baseAbs, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(baseAbs, abs)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes default project directory")
	}
	return abs, nil
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
