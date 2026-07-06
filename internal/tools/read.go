package tools

import (
	"context"
	"encoding/json"
	"os"
)

type ReadTool struct{}

type readInput struct {
	FilePath string `json:"file_path"`
	Limit    int    `json:"limit,omitempty"`
}

func (ReadTool) Name() string              { return "Read" }
func (ReadTool) Description() string       { return "Read a file from the agent working directory." }
func (ReadTool) Schema() any               { return readInput{} }
func (ReadTool) Risk(json.RawMessage) Risk { return RiskRead }

func (ReadTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input readInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	path, err := resolveInCWD(env.CWD, input.FilePath)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	limit := input.Limit
	if limit == 0 {
		limit = 100000
	}
	text, cut := truncate(string(data), limit)
	return Result{Output: text, Meta: map[string]any{"path": path, "truncated": cut}}, nil
}
