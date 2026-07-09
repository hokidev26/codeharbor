package agent

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxProjectInstructionReadBytes = 64 * 1024
	maxProjectInstructionFileRunes = 6000
)

var projectInstructionFilenames = []string{"AGENTS.md", "CLAUDE.md"}

type projectInstructionBundle struct {
	Text  string
	Files []projectInstructionFile
}

type projectInstructionFile struct {
	Name      string
	Path      string
	Truncated bool
}

func loadProjectInstructions(cwd string) projectInstructionBundle {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return projectInstructionBundle{}
	}
	sections := make([]string, 0, len(projectInstructionFilenames))
	files := make([]projectInstructionFile, 0, len(projectInstructionFilenames))
	for _, name := range projectInstructionFilenames {
		path, ok := projectInstructionPath(cwd, name)
		if !ok {
			continue
		}
		content, truncated, err := readProjectInstructionFile(path)
		if err != nil || strings.TrimSpace(content) == "" {
			continue
		}
		files = append(files, projectInstructionFile{Name: name, Path: path, Truncated: truncated})
		truncationNote := ""
		if truncated {
			truncationNote = "\n\n[CodeHarbor note: this instruction file was truncated to fit the safety limit.]"
		}
		sections = append(sections, fmt.Sprintf("### %s\n\n%s%s", name, strings.TrimSpace(content), truncationNote))
	}
	if len(sections) == 0 {
		return projectInstructionBundle{}
	}
	return projectInstructionBundle{Text: "## Project instructions loaded by CodeHarbor\n\n" + strings.Join(sections, "\n\n"), Files: files}
}

func projectInstructionPath(cwd, name string) (string, bool) {
	root, err := filepath.Abs(cwd)
	if err != nil {
		return "", false
	}
	path, err := filepath.Abs(filepath.Join(root, name))
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false
	}
	return path, true
}

func readProjectInstructionFile(path string) (string, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", false, err
	}
	defer file.Close()
	limited := io.LimitReader(file, maxProjectInstructionReadBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return "", false, err
	}
	truncated := len(data) > maxProjectInstructionReadBytes
	if truncated {
		data = data[:maxProjectInstructionReadBytes]
	}
	content := truncateRunes(string(data), maxProjectInstructionFileRunes)
	if len([]rune(strings.TrimSpace(string(data)))) > maxProjectInstructionFileRunes {
		truncated = true
	}
	return content, truncated, nil
}

func mergeProjectInstructions(systemPrompt string, bundle projectInstructionBundle) string {
	if strings.TrimSpace(bundle.Text) == "" {
		return systemPrompt
	}
	if strings.TrimSpace(systemPrompt) == "" {
		return bundle.Text
	}
	return strings.TrimSpace(systemPrompt) + "\n\n" + bundle.Text
}

func (b projectInstructionBundle) eventData() map[string]any {
	if len(b.Files) == 0 {
		return nil
	}
	files := make([]map[string]any, 0, len(b.Files))
	for _, file := range b.Files {
		files = append(files, map[string]any{"name": file.Name, "path": file.Path, "truncated": file.Truncated})
	}
	return map[string]any{"files": files}
}
