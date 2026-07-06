package tools

import (
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type BashTool struct{}

type bashInput struct {
	Command string `json:"command"`
	Timeout int    `json:"timeout,omitempty"`
}

func (BashTool) Name() string        { return "Bash" }
func (BashTool) Description() string { return "Run a shell command in the agent working directory." }
func (BashTool) Schema() any         { return bashInput{} }
func (BashTool) Risk(input json.RawMessage) Risk {
	var parsed bashInput
	_ = json.Unmarshal(input, &parsed)
	cmd := strings.TrimSpace(strings.ToLower(parsed.Command))
	if strings.HasPrefix(cmd, "rm ") || strings.HasPrefix(cmd, "rm -") || strings.HasPrefix(cmd, "rmdir ") || strings.Contains(cmd, " shred ") {
		return RiskDanger
	}
	return RiskExec
}

func (BashTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input bashInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	if strings.TrimSpace(input.Command) == "" {
		return Result{Output: "command is required", IsError: true}, nil
	}
	timeout := time.Duration(input.Timeout) * time.Millisecond
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	shell := "/bin/sh"
	args := []string{"-c", input.Command}
	if runtime.GOOS == "windows" {
		shell = "cmd"
		args = []string{"/C", input.Command}
	}
	cmd := exec.CommandContext(cmdCtx, shell, args...)
	if env.CWD != "" {
		cmd.Dir = env.CWD
	}
	output, err := cmd.CombinedOutput()
	text, cut := truncate(string(output), 20000)
	result := Result{Output: text, Meta: map[string]any{"truncated": cut}}
	if cmdCtx.Err() != nil {
		result.IsError = true
		result.Output += "\ncommand timed out"
		return result, nil
	}
	if err != nil {
		result.IsError = true
		if text == "" {
			result.Output = err.Error()
		}
	}
	return result, nil
}
