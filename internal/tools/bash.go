package tools

import (
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
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
	if BashDangerWarning(BashCommand(input)) != "" {
		return RiskDanger
	}
	return RiskExec
}

func BashCommand(input json.RawMessage) string {
	var parsed bashInput
	_ = json.Unmarshal(input, &parsed)
	return strings.TrimSpace(parsed.Command)
}

func BashDangerWarning(command string) string {
	cmd := strings.TrimSpace(strings.ToLower(command))
	if cmd == "" {
		return ""
	}
	fields := strings.Fields(cmd)
	if len(fields) > 0 {
		switch fields[0] {
		case "rm", "rmdir":
			return "删除命令会永久移除文件或目录，本轮安全策略禁止自动执行。"
		case "sudo", "dd":
			return "高权限或磁盘级命令风险过高，本轮安全策略禁止自动执行。"
		}
		if strings.HasPrefix(fields[0], "mkfs") {
			return "格式化磁盘命令风险过高，本轮安全策略禁止自动执行。"
		}
	}
	if strings.Contains(cmd, " shred ") || strings.HasPrefix(cmd, "shred ") {
		return "shred 会破坏文件内容，本轮安全策略禁止自动执行。"
	}
	if strings.Contains(cmd, "find ") && strings.Contains(cmd, " -delete") {
		return "find -delete 会批量删除文件，本轮安全策略禁止自动执行。"
	}
	if strings.HasPrefix(cmd, "find ") && strings.Contains(cmd, " -delete") {
		return "find -delete 会批量删除文件，本轮安全策略禁止自动执行。"
	}
	if strings.HasPrefix(cmd, "git clean") && strings.Contains(cmd, "-f") {
		return "git clean -f 会删除未跟踪文件，本轮安全策略禁止自动执行。"
	}
	if strings.HasPrefix(cmd, "git reset") && strings.Contains(cmd, "--hard") {
		return "git reset --hard 会丢弃本地改动，本轮安全策略禁止自动执行。"
	}
	if strings.Contains(cmd, "curl") && shellPipesToShell(cmd) {
		return "curl 管道执行 shell 风险过高，本轮安全策略禁止自动执行。"
	}
	if strings.Contains(cmd, "wget") && shellPipesToShell(cmd) {
		return "wget 管道执行 shell 风险过高，本轮安全策略禁止自动执行。"
	}
	if strings.Contains(cmd, "chmod") && strings.Contains(cmd, "-r") && strings.Contains(cmd, "777") {
		return "递归 chmod 777 会放宽大量文件权限，本轮安全策略禁止自动执行。"
	}
	if strings.Contains(cmd, " /dev/null") && strings.HasPrefix(cmd, "mv ") {
		return "移动到 /dev/null 可能破坏文件，本轮安全策略禁止自动执行。"
	}
	if truncatingRedirectPattern.MatchString(cmd) {
		return "shell 重定向截断文件风险较高，本轮安全策略禁止自动执行。"
	}
	return ""
}

var truncatingRedirectPattern = regexp.MustCompile(`(^|\s|[;&|])(:\s*)?>\s*[^&\s]`)

func shellPipesToShell(cmd string) bool {
	return regexp.MustCompile(`\|\s*(sh|bash|zsh|dash)(\s|$)`).MatchString(cmd)
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
