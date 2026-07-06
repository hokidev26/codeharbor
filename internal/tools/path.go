package tools

import (
	"errors"
	"path/filepath"
	"strings"
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
		return "", err
	}
	path := inputPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes working directory")
	}
	return abs, nil
}

func truncate(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	return s[:max] + "\n...[truncated]", true
}
