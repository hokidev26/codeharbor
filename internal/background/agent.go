package background

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"autoto/internal/agent"
	"autoto/internal/db"
)

const (
	maxAgentTaskPromptBytes = 64 * 1024
	maxAgentTaskMetaBytes   = 256
	maxAgentParentDepth     = 8
	maxAgentResultBytes     = 4096
)

type AgentExecutor struct {
	Store        *db.Store
	Runner       *agent.Runner
	PollInterval time.Duration
}

type agentPayload struct {
	Prompt          string `json:"prompt"`
	Description     string `json:"description,omitempty"`
	SubagentType    string `json:"subagentType,omitempty"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

func NewAgentExecutor(store *db.Store, runner *agent.Runner) *AgentExecutor {
	return &AgentExecutor{Store: store, Runner: runner, PollInterval: 50 * time.Millisecond}
}

func (e *AgentExecutor) Execute(ctx context.Context, task db.BackgroundTask, output OutputWriter) (Result, error) {
	if e == nil || e.Store == nil || e.Runner == nil {
		return Result{ErrorCode: "agent_executor_unavailable"}, errors.New("background agent executor is unavailable")
	}
	payload, err := parseAgentPayload(task.PayloadJSON)
	if err != nil {
		return Result{ErrorCode: "invalid_payload"}, err
	}
	parent, err := e.Store.GetAgent(ctx, task.OwnerAgentID)
	if err != nil {
		return Result{ErrorCode: "parent_agent_unavailable"}, fmt.Errorf("load parent agent: %w", err)
	}
	if err := validateAgentTaskScope(e.Store, ctx, task, parent); err != nil {
		return Result{ErrorCode: "scope_rejected"}, err
	}
	permissionCap, err := childPermissionCap(parent.PermissionMode, task.PermissionModeCap)
	if err != nil {
		return Result{ErrorCode: "permission_rejected"}, err
	}
	model, subagentType, err := e.Runner.ResolveSubagentModel(payload.SubagentType, payload.Model, parent.Model)
	if err != nil {
		return Result{ErrorCode: "subagent_model_rejected"}, err
	}
	title := payload.Description
	if title == "" {
		title = "Background agent task"
	}
	child, err := e.Store.CreateAgent(ctx, db.Agent{
		WorklineID: parent.WorklineID, ParentAgentID: parent.ID, Type: "subagent", SubagentType: subagentType,
		Title: title, Model: model, PermissionMode: permissionCap, ReasoningEffort: payload.ReasoningEffort,
		ExecutionDeviceID: parent.ExecutionDeviceID, Status: "idle", CWD: parent.CWD,
	})
	if err != nil {
		return Result{ErrorCode: "child_agent_create_failed"}, fmt.Errorf("create child agent: %w", err)
	}
	childRun, err := e.Runner.SubmitInternal(ctx, child.ID, task.ID, payload.Prompt, permissionCap)
	if err != nil {
		return Result{ErrorCode: "child_run_submit_failed"}, fmt.Errorf("submit child run: %w", err)
	}
	attached, err := e.Store.AttachBackgroundTaskChild(ctx, task.ID, task.Revision, child.ID, childRun.ID)
	if err != nil {
		_, _ = e.Runner.Interrupt(context.Background(), child.ID)
		return Result{ErrorCode: "child_attach_conflict"}, fmt.Errorf("attach child run: %w", err)
	}
	if err := output.Write("system", []byte("background child agent started\n")); err != nil {
		return Result{ErrorCode: "output_failed"}, err
	}
	return e.waitChild(ctx, attached, child)
}

func (e *AgentExecutor) waitChild(ctx context.Context, task db.BackgroundTask, child db.Agent) (Result, error) {
	interval := e.PollInterval
	if interval <= 0 {
		interval = 50 * time.Millisecond
	}
	for {
		run, err := e.Store.GetRunByID(ctx, task.ChildRunID)
		if err != nil {
			return Result{ErrorCode: "child_run_unavailable"}, fmt.Errorf("load child run: %w", err)
		}
		if terminalRun(run.Status) {
			result, _ := json.Marshal(map[string]any{"childAgentId": child.ID, "childRunId": run.ID, "status": run.Status})
			if run.Status == "completed" {
				return Result{JSON: result}, nil
			}
			return Result{JSON: result, ErrorCode: "child_" + strings.ToLower(run.Status)}, errors.New("background child agent did not complete")
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			_ = timer.Stop()
			_, _ = e.Runner.Interrupt(context.Background(), child.ID)
			return Result{ErrorCode: "canceled"}, ctx.Err()
		case <-timer.C:
		}
	}
}

func parseAgentPayload(raw json.RawMessage) (agentPayload, error) {
	if len(raw) == 0 || len(raw) > 128*1024 || !json.Valid(raw) {
		return agentPayload{}, errors.New("agent payload must be a valid JSON object")
	}
	var payload agentPayload
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return agentPayload{}, errors.New("agent payload must contain only prompt, description, subagentType, model, and reasoningEffort")
	}
	payload.Prompt = strings.TrimSpace(payload.Prompt)
	payload.Description = strings.TrimSpace(payload.Description)
	payload.SubagentType = strings.ToLower(strings.TrimSpace(payload.SubagentType))
	payload.Model = strings.TrimSpace(payload.Model)
	payload.ReasoningEffort = strings.ToLower(strings.TrimSpace(payload.ReasoningEffort))
	if payload.Prompt == "" || len(payload.Prompt) > maxAgentTaskPromptBytes || !utf8.ValidString(payload.Prompt) || strings.ContainsRune(payload.Prompt, 0) {
		return agentPayload{}, errors.New("agent task prompt is invalid")
	}
	for name, value := range map[string]string{"description": payload.Description, "subagentType": payload.SubagentType, "model": payload.Model} {
		if len(value) > maxAgentTaskMetaBytes || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
			return agentPayload{}, fmt.Errorf("agent task %s is invalid", name)
		}
	}
	switch payload.SubagentType {
	case "", "background", "general", "explore", "plan", "search":
	default:
		return agentPayload{}, errors.New("agent task subagentType is invalid")
	}
	switch payload.ReasoningEffort {
	case "", "auto", "low", "medium", "high", "xhigh":
	default:
		return agentPayload{}, errors.New("agent task reasoning effort is invalid")
	}
	return payload, nil
}

func validateAgentTaskScope(store *db.Store, ctx context.Context, task db.BackgroundTask, parent db.Agent) error {
	if cwd := strings.TrimSpace(taskPayloadCWD(task)); cwd != "" && cwd != parent.CWD {
		return errors.New("background agent task cwd does not match parent cwd")
	}
	current := parent
	for depth := 0; current.ParentAgentID != ""; depth++ {
		if depth >= maxAgentParentDepth {
			return errors.New("background agent task parent depth exceeds limit")
		}
		next, err := store.GetAgent(ctx, current.ParentAgentID)
		if err != nil {
			return errors.New("background agent task parent chain is unavailable")
		}
		current = next
	}
	return nil
}

// Agent payloads have no CWD field. Keeping this helper makes the invariant
// explicit and leaves no route for a future payload extension to bypass it.
func taskPayloadCWD(task db.BackgroundTask) string { return "" }

func childPermissionCap(parentMode, requestedCap string) (string, error) {
	rank := func(mode string) int {
		switch strings.TrimSpace(mode) {
		case "readOnly":
			return 1
		case "acceptEdits", "bypassPermissions", "default", "dontAsk":
			return 2
		default:
			return 0
		}
	}
	parentRank := rank(parentMode)
	if parentRank == 0 {
		return "", errors.New("parent agent permission mode is invalid")
	}
	requestedRank := rank(requestedCap)
	if strings.TrimSpace(requestedCap) == "" {
		requestedRank = parentRank
	}
	if requestedRank == 0 || requestedRank > parentRank {
		return "", errors.New("background agent task cannot widen permission capability")
	}
	if requestedRank == 1 {
		return "readOnly", nil
	}
	return "acceptEdits", nil
}

func terminalRun(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "error", "failed", "interrupted", "superseded", "denied":
		return true
	default:
		return false
	}
}
