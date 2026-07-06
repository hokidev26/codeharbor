package tools

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
)

type GlobTool struct{}

type globInput struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path,omitempty"`
}

func (GlobTool) Name() string { return "Glob" }
func (GlobTool) Description() string {
	return "Find files by glob pattern under the agent working directory."
}
func (GlobTool) Schema() any               { return globInput{} }
func (GlobTool) Risk(json.RawMessage) Risk { return RiskRead }

func (GlobTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input globInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	if input.Pattern == "" {
		return Result{Output: "pattern is required", IsError: true}, nil
	}
	root := env.CWD
	if input.Path != "" {
		resolved, err := resolveInCWD(env.CWD, input.Path)
		if err != nil {
			return Result{Output: err.Error(), IsError: true}, nil
		}
		root = resolved
	}
	matches, err := filepath.Glob(filepath.Join(root, input.Pattern))
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	for i, match := range matches {
		if rel, err := filepath.Rel(root, match); err == nil {
			matches[i] = rel
		}
	}
	out := strings.Join(matches, "\n")
	if out == "" {
		out = "No matches found"
	}
	return Result{Output: out, Meta: map[string]any{"count": len(matches)}}, nil
}
