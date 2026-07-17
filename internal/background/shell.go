package background

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"

	"autoto/internal/db"
)

type ShellExecutor struct {
	TerminateGrace time.Duration
}

type ShellPayload struct {
	Command   string `json:"command"`
	CWD       string `json:"cwd,omitempty"`
	TimeoutMS int64  `json:"timeoutMs,omitempty"`
}

func NewShellExecutor() *ShellExecutor {
	return &ShellExecutor{TerminateGrace: 2 * time.Second}
}

func (executor *ShellExecutor) Execute(ctx context.Context, task db.BackgroundTask, output OutputWriter) (Result, error) {
	payload, err := parseShellPayload(task.PayloadJSON)
	if err != nil {
		return Result{ErrorCode: "invalid_payload"}, err
	}
	executionContext := ctx
	cancelTimeout := func() {}
	if payload.TimeoutMS > 0 {
		executionContext, cancelTimeout = context.WithTimeout(ctx, time.Duration(payload.TimeoutMS)*time.Millisecond)
	}
	defer cancelTimeout()
	command := newShellCommand(payload.Command)
	command.Dir = payload.CWD
	command.Stdout = streamWriter{output: output, stream: "stdout"}
	command.Stderr = streamWriter{output: output, stream: "stderr"}
	configureCommandProcessGroup(command)
	if err := command.Start(); err != nil {
		return Result{ErrorCode: "start_failed"}, fmt.Errorf("start shell command: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()

	var waitErr error
	select {
	case waitErr = <-done:
	case <-executionContext.Done():
		grace := executor.TerminateGrace
		if grace <= 0 {
			grace = 2 * time.Second
		}
		waitErr = terminateCommandProcessGroup(command, done, grace)
		exitCode := processExitCode(command)
		errorCode := "canceled"
		if errors.Is(executionContext.Err(), context.DeadlineExceeded) {
			errorCode = "timeout"
		}
		return Result{JSON: shellResultJSON(exitCode), ExitCode: &exitCode, ErrorCode: errorCode}, executionContext.Err()
	}
	exitCode := processExitCode(command)
	result := Result{JSON: shellResultJSON(exitCode), ExitCode: &exitCode}
	if waitErr != nil {
		var exitError *exec.ExitError
		if errors.As(waitErr, &exitError) {
			result.ErrorCode = "nonzero_exit"
			return result, fmt.Errorf("shell command exited with code %d", exitCode)
		}
		result.ErrorCode = "wait_failed"
		return result, fmt.Errorf("wait for shell command: %w", waitErr)
	}
	return result, nil
}

type streamWriter struct {
	output OutputWriter
	stream string
}

func (writer streamWriter) Write(chunk []byte) (int, error) {
	if err := writer.output.Write(writer.stream, chunk); err != nil {
		return 0, err
	}
	return len(chunk), nil
}

func parseShellPayload(raw json.RawMessage) (ShellPayload, error) {
	if len(raw) == 0 || len(raw) > 262144 || !json.Valid(raw) {
		return ShellPayload{}, errors.New("shell payload must be a valid JSON object")
	}
	var payload ShellPayload
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return ShellPayload{}, errors.New("shell payload must contain only command, cwd, and timeoutMs")
	}
	payload.Command = strings.TrimSpace(payload.Command)
	payload.CWD = strings.TrimSpace(payload.CWD)
	if payload.Command == "" || len(payload.Command) > 131072 || !utf8.ValidString(payload.Command) || strings.ContainsRune(payload.Command, 0) {
		return ShellPayload{}, errors.New("shell command is invalid")
	}
	if len(payload.CWD) > 4096 || !utf8.ValidString(payload.CWD) || strings.ContainsRune(payload.CWD, 0) {
		return ShellPayload{}, errors.New("shell cwd is invalid")
	}
	if payload.TimeoutMS < 0 || payload.TimeoutMS > int64((24*time.Hour)/time.Millisecond) {
		return ShellPayload{}, errors.New("shell timeoutMs is invalid")
	}
	return payload, nil
}

func shellResultJSON(exitCode int) json.RawMessage {
	encoded, _ := json.Marshal(map[string]int{"exitCode": exitCode})
	return encoded
}

func processExitCode(command *exec.Cmd) int {
	if command.ProcessState == nil {
		return -1
	}
	return command.ProcessState.ExitCode()
}
