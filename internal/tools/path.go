package tools

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"autoto/internal/workspacefs"
)

func resolveInCWD(cwd, inputPath string) (string, error) {
	if inputPath == "" {
		return "", errors.New("path is required")
	}
	if cwd == "" {
		cwd = "."
	}
	base, err := filepath.Abs(cwd)
	if err != nil {
		return "", errors.New("cannot resolve working directory")
	}
	path := inputPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", errors.New("cannot resolve path")
	}
	if !pathIsWithin(base, abs) {
		return "", errors.New("path escapes working directory")
	}
	if sensitiveToolPath(base, abs) {
		return "", errors.New("sensitive path is not accessible")
	}

	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", errors.New("cannot resolve working directory")
	}

	// For a new path, resolve the nearest existing ancestor. This catches
	// writes through a symlinked parent without requiring the target to exist.
	existing := abs
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", errors.New("cannot inspect path")
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return "", errors.New("cannot resolve path")
		}
		existing = parent
	}

	realExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", errors.New("cannot resolve path")
	}
	if !pathIsWithin(realBase, realExisting) {
		return "", errors.New("path escapes working directory")
	}
	return abs, nil
}

func pathIsWithin(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func sensitiveToolPath(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil || filepath.IsAbs(rel) {
		return true
	}
	rel = filepath.ToSlash(rel)
	if workspacefs.IsSensitivePath(rel) {
		return true
	}
	for _, component := range strings.Split(strings.ToLower(rel), "/") {
		if component == ".git" {
			return true
		}
	}
	return false
}

func heavyToolDirectory(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "target", ".next", ".nuxt", "coverage", "out":
		return true
	default:
		return false
	}
}

func truncate(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	return s[:max] + "\n...[truncated]", true
}
