package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type EditTool struct{}

type editInput struct {
	FilePath   string `json:"file_path"`
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
	ReplaceAll bool   `json:"replace_all,omitempty"`
}

func (EditTool) Name() string { return "Edit" }
func (EditTool) Description() string {
	return "Replace text in an existing file under the agent working directory."
}
func (EditTool) Schema() any               { return editInput{} }
func (EditTool) Risk(json.RawMessage) Risk { return RiskWrite }

func (EditTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input editInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	if input.FilePath == "" || input.OldString == "" {
		return Result{Output: "file_path and old_string are required", IsError: true}, nil
	}
	if input.OldString == input.NewString {
		return Result{Output: "old_string and new_string must differ", IsError: true}, nil
	}
	path, err := resolveInCWD(env.CWD, input.FilePath)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	text := string(data)
	count := strings.Count(text, input.OldString)
	if count == 0 {
		return Result{Output: "old_string not found", IsError: true}, nil
	}
	if !input.ReplaceAll && count != 1 {
		return Result{Output: fmt.Sprintf("old_string is not unique; found %d occurrences", count), IsError: true}, nil
	}
	replacements := 1
	if input.ReplaceAll {
		replacements = -1
	}
	updated := strings.Replace(text, input.OldString, input.NewString, replacements)
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	changed := 1
	if input.ReplaceAll {
		changed = count
	}
	return Result{Output: fmt.Sprintf("Edited %s (%d replacement(s))", path, changed), Meta: map[string]any{"path": path, "replacements": changed}}, nil
}
