package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type AgentTool struct{}

type agentTaskInput struct {
	Prompt          string `json:"prompt"`
	Description     string `json:"description,omitempty"`
	SubagentType    string `json:"subagent_type,omitempty"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
	RunInBackground *bool  `json:"run_in_background,omitempty"`
	ResumeParent    bool   `json:"resume_parent,omitempty"`
}

type agentTaskPayload struct {
	Prompt          string `json:"prompt"`
	Description     string `json:"description,omitempty"`
	SubagentType    string `json:"subagentType,omitempty"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

func (AgentTool) Name() string { return "Agent" }
func (AgentTool) Description() string {
	return "Start a child agent as a durable background task and return its task handle immediately."
}
func (AgentTool) Schema() any               { return agentTaskInput{} }
func (AgentTool) Risk(json.RawMessage) Risk { return RiskExec }

func (AgentTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input agentTaskInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	input.Prompt = strings.TrimSpace(input.Prompt)
	input.Description = strings.TrimSpace(input.Description)
	input.SubagentType = strings.ToLower(strings.TrimSpace(input.SubagentType))
	input.Model = strings.TrimSpace(input.Model)
	input.ReasoningEffort = strings.TrimSpace(input.ReasoningEffort)
	if input.Prompt == "" {
		return Result{Output: "prompt is required", IsError: true}, nil
	}
	if len([]byte(input.Prompt)) > 64*1024 {
		return Result{Output: "prompt exceeds size limit", IsError: true}, nil
	}
	if len([]byte(input.Description)) > 200 || len([]byte(input.Model)) > 256 || len([]byte(input.SubagentType)) > 64 {
		return Result{Output: "agent task metadata exceeds size limit", IsError: true}, nil
	}
	if input.SubagentType != "" && !validSubagentType(input.SubagentType) {
		return Result{Output: "invalid subagent_type", IsError: true}, nil
	}
	if input.RunInBackground != nil && !*input.RunInBackground {
		return Result{Output: "foreground child agents are not supported; set run_in_background to true", IsError: true}, nil
	}
	switch input.ReasoningEffort {
	case "", "auto", "low", "medium", "high", "xhigh":
	default:
		return Result{Output: "invalid reasoning_effort", IsError: true}, nil
	}
	if env.Background == nil {
		return Result{Output: "background task service is unavailable", IsError: true}, nil
	}
	if input.ResumeParent && strings.TrimSpace(env.RunID) == "" {
		return Result{Output: "resume_parent requires a durable parent run", IsError: true}, nil
	}
	payload, err := json.Marshal(agentTaskPayload{
		Prompt: input.Prompt, Description: input.Description, SubagentType: input.SubagentType, Model: input.Model, ReasoningEffort: input.ReasoningEffort,
	})
	if err != nil {
		return Result{}, err
	}
	publicSummary, _ := json.Marshal(map[string]any{
		"description":  input.Description,
		"subagentType": input.SubagentType,
		"model":        input.Model,
	})
	task, err := env.Background.Submit(ctx, BackgroundTaskRequest{
		Kind:                         BackgroundTaskKindAgent,
		OwnerAgentID:                 env.AgentID,
		ParentRunID:                  env.RunID,
		ParentToolUseID:              call.ID,
		CWD:                          env.CWD,
		Payload:                      payload,
		PublicSummary:                publicSummary,
		ResumeParent:                 input.ResumeParent,
		PermissionModeCap:            env.PermissionModeCap,
		PermissionGenerationSnapshot: env.PermissionGenerationSnapshot,
		PolicyGenerationSnapshot:     env.PolicyGenerationSnapshot,
		AgentGenerationSnapshot:      env.AgentGenerationSnapshot,
		ToolCatalogDigest:            env.ToolCatalogDigest,
		WorkspaceFingerprint:         env.WorkspaceFingerprint,
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return Result{}, err
		}
		return Result{Output: "background agent task could not be created", IsError: true}, nil
	}
	encoded, _ := json.Marshal(task)
	return Result{Output: string(encoded), Meta: map[string]any{"backgroundTaskId": task.ID, "background": true}}, nil
}

func validSubagentType(value string) bool {
	if value == "" {
		return false
	}
	for index, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || (char == '.' && index > 0) {
			continue
		}
		return false
	}
	return true
}
