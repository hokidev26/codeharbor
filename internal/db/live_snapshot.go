package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type PermissionGenerations struct {
	Entity     int64 `json:"entity"`
	Permission int64 `json:"permission"`
	Policy     int64 `json:"policy"`
}

type AgentLiveSnapshot struct {
	Agent                Agent                 `json:"agent"`
	Messages             []Message             `json:"messages"`
	MessageHasMoreBefore bool                  `json:"messageHasMoreBefore"`
	MessageNextBefore    string                `json:"messageNextBefore,omitempty"`
	PendingApprovals     []ToolCall            `json:"pendingApprovals"`
	LatestRun            *Run                  `json:"latestRun,omitempty"`
	Generations          PermissionGenerations `json:"generations"`
}

func (s *Store) GetPermissionGenerations(ctx context.Context, agentID string) (PermissionGenerations, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return PermissionGenerations{}, err
	}
	defer tx.Rollback()
	generations := PermissionGenerations{Policy: 1}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(entity_generation,1), COALESCE(permission_generation,1) FROM agents WHERE id = ?`, agentID).Scan(&generations.Entity, &generations.Permission); err != nil {
		return PermissionGenerations{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(policy_generation,1) FROM workflow_preferences WHERE id = 'default'`).Scan(&generations.Policy); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return PermissionGenerations{}, err
	}
	if err := tx.Commit(); err != nil {
		return PermissionGenerations{}, err
	}
	return generations, nil
}

func (s *Store) ReadAgentLiveSnapshot(ctx context.Context, agentID string) (AgentLiveSnapshot, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return AgentLiveSnapshot{}, err
	}
	defer tx.Rollback()

	var snapshot AgentLiveSnapshot
	var planMode int
	if err := tx.QueryRowContext(ctx, `SELECT id, COALESCE(workline_id,''), type, COALESCE(subagent_type,''), title, model, COALESCE(system_prompt,''), permission_mode, COALESCE(reasoning_effort,''), COALESCE(entity_generation,1), COALESCE(permission_generation,1), status, plan_mode, COALESCE(cwd,''), message_count, COALESCE(context_summary,''), COALESCE(prune_boundary_message_id,''), COALESCE(pruned_percent,0), created_at, updated_at FROM agents WHERE id = ?`, agentID).Scan(
		&snapshot.Agent.ID, &snapshot.Agent.WorklineID, &snapshot.Agent.Type, &snapshot.Agent.SubagentType, &snapshot.Agent.Title, &snapshot.Agent.Model,
		&snapshot.Agent.SystemPrompt, &snapshot.Agent.PermissionMode, &snapshot.Agent.ReasoningEffort, &snapshot.Agent.EntityGeneration, &snapshot.Agent.PermissionGeneration,
		&snapshot.Agent.Status, &planMode, &snapshot.Agent.CWD, &snapshot.Agent.MessageCount, &snapshot.Agent.ContextSummary,
		&snapshot.Agent.PruneBoundaryMessageID, &snapshot.Agent.PrunedPercent, &snapshot.Agent.CreatedAt, &snapshot.Agent.UpdatedAt,
	); err != nil {
		return AgentLiveSnapshot{}, err
	}
	snapshot.Agent.PlanMode = planMode != 0
	snapshot.Generations = PermissionGenerations{Entity: snapshot.Agent.EntityGeneration, Permission: snapshot.Agent.PermissionGeneration, Policy: 1}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(policy_generation,1) FROM workflow_preferences WHERE id = 'default'`).Scan(&snapshot.Generations.Policy); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return AgentLiveSnapshot{}, err
	}

	messageRows, err := tx.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), role, COALESCE(content_json,''), COALESCE(provider_state_json,''), COALESCE(content_text,''), COALESCE(parent_tool_use_id,''), COALESCE(command_text,''), COALESCE(correction_of_message_id,''), COALESCE(created_by,''), created_at FROM agent_messages WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, agentID, DefaultMessagePageLimit+1)
	if err != nil {
		return AgentLiveSnapshot{}, err
	}
	for messageRows.Next() {
		var message Message
		var raw, providerState string
		if err := messageRows.Scan(&message.ID, &message.AgentID, &message.RunID, &message.Role, &raw, &providerState, &message.ContentText, &message.ParentToolID, &message.CommandText, &message.CorrectionOfMessageID, &message.CreatedBy, &message.CreatedAt); err != nil {
			messageRows.Close()
			return AgentLiveSnapshot{}, err
		}
		if raw != "" {
			message.ContentJSON = json.RawMessage(raw)
		}
		if providerState != "" {
			message.ProviderStateJSON = json.RawMessage(providerState)
		}
		snapshot.Messages = append(snapshot.Messages, message)
	}
	if err := messageRows.Err(); err != nil {
		messageRows.Close()
		return AgentLiveSnapshot{}, err
	}
	if err := messageRows.Close(); err != nil {
		return AgentLiveSnapshot{}, err
	}
	if len(snapshot.Messages) > DefaultMessagePageLimit {
		snapshot.MessageHasMoreBefore = true
		snapshot.Messages = snapshot.Messages[:DefaultMessagePageLimit]
	}
	for i, j := 0, len(snapshot.Messages)-1; i < j; i, j = i+1, j-1 {
		snapshot.Messages[i], snapshot.Messages[j] = snapshot.Messages[j], snapshot.Messages[i]
	}
	if snapshot.MessageHasMoreBefore && len(snapshot.Messages) > 0 {
		snapshot.MessageNextBefore, err = encodeMessageCursor(messageCursor{CreatedAt: snapshot.Messages[0].CreatedAt, ID: snapshot.Messages[0].ID})
		if err != nil {
			return AgentLiveSnapshot{}, err
		}
	}
	for i := range snapshot.Messages {
		attachmentRows, err := tx.QueryContext(ctx, `SELECT id, message_id, agent_id, filename, COALESCE(mime_type,''), kind, size_bytes, created_at FROM agent_message_attachments WHERE message_id = ? ORDER BY created_at ASC`, snapshot.Messages[i].ID)
		if err != nil {
			return AgentLiveSnapshot{}, err
		}
		for attachmentRows.Next() {
			var attachment Attachment
			if err := attachmentRows.Scan(&attachment.ID, &attachment.MessageID, &attachment.AgentID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &attachment.CreatedAt); err != nil {
				attachmentRows.Close()
				return AgentLiveSnapshot{}, err
			}
			snapshot.Messages[i].Attachments = append(snapshot.Messages[i].Attachments, attachment)
		}
		if err := attachmentRows.Err(); err != nil {
			attachmentRows.Close()
			return AgentLiveSnapshot{}, err
		}
		if err := attachmentRows.Close(); err != nil {
			return AgentLiveSnapshot{}, err
		}
	}

	callRows, err := tx.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(permission_deny_message,''), COALESCE(permission_decision_reason,''), COALESCE(permission_suggestions,''), COALESCE(permission_generation,1), COALESCE(policy_generation,1), COALESCE(started_at,''), COALESCE(completed_at,''), created_at, COALESCE(updated_at, created_at) FROM agent_tool_calls WHERE agent_id = ? AND status = 'pending_approval' ORDER BY created_at ASC`, agentID)
	if err != nil {
		return AgentLiveSnapshot{}, err
	}
	for callRows.Next() {
		var call ToolCall
		var input, output string
		if err := callRows.Scan(&call.ID, &call.AgentID, &call.RunID, &call.MessageID, &call.ToolUseID, &call.ToolName, &input, &output, &call.Status, &call.DurationMS, &call.ErrorMessage, &call.PermissionDecidedBy, &call.PermissionDecidedAt, &call.PermissionDenyMessage, &call.PermissionDecisionReason, &call.PermissionSuggestions, &call.PermissionGeneration, &call.PolicyGeneration, &call.StartedAt, &call.CompletedAt, &call.CreatedAt, &call.UpdatedAt); err != nil {
			callRows.Close()
			return AgentLiveSnapshot{}, err
		}
		if input != "" {
			call.InputJSON = json.RawMessage(input)
		}
		if output != "" {
			call.OutputJSON = json.RawMessage(output)
		}
		snapshot.PendingApprovals = append(snapshot.PendingApprovals, call)
	}
	if err := callRows.Err(); err != nil {
		callRows.Close()
		return AgentLiveSnapshot{}, err
	}
	if err := callRows.Close(); err != nil {
		return AgentLiveSnapshot{}, err
	}

	var run Run
	if err := tx.QueryRowContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, COALESCE(started_at,''), COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE agent_id = ? ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT 1`, agentID).Scan(
		&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead,
		&run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt,
	); err == nil {
		snapshot.LatestRun = &run
	} else if !errors.Is(err, sql.ErrNoRows) {
		return AgentLiveSnapshot{}, err
	}

	if err := tx.Commit(); err != nil {
		return AgentLiveSnapshot{}, err
	}
	return snapshot, nil
}
