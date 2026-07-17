package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"autoto/internal/db"
)

// ValidateBackgroundTask revalidates the durable permission and workspace
// boundary immediately before a queued task starts. A background task may
// outlive its parent Run, but it must never outlive the policy approval or
// workspace snapshot under which it was created.
func (r *Runner) ValidateBackgroundTask(ctx context.Context, task db.BackgroundTask) error {
	if r == nil || r.store == nil {
		return errors.New("agent runner is unavailable")
	}
	agent, err := r.store.GetAgent(ctx, strings.TrimSpace(task.OwnerAgentID))
	if err != nil {
		return fmt.Errorf("load background task owner: %w", err)
	}
	generations, err := r.store.GetPermissionGenerations(ctx, agent.ID)
	if err != nil {
		return fmt.Errorf("load background task generations: %w", err)
	}
	if task.PermissionGenerationSnapshot > 0 && generations.Permission != task.PermissionGenerationSnapshot {
		return errors.New("background task permission generation changed")
	}
	if task.PolicyGenerationSnapshot > 0 && generations.Policy != task.PolicyGenerationSnapshot {
		return errors.New("background task policy generation changed")
	}
	if task.AgentGenerationSnapshot > 0 && generations.Entity != task.AgentGenerationSnapshot {
		return errors.New("background task agent generation changed")
	}

	if parentRunID := strings.TrimSpace(task.ParentRunID); parentRunID != "" {
		run, err := r.store.GetRunByID(ctx, parentRunID)
		if err != nil {
			return fmt.Errorf("load background task parent run: %w", err)
		}
		if run.AgentID != agent.ID {
			return errors.New("background task parent run owner changed")
		}
		if task.PolicyGenerationSnapshot == 0 || task.AgentGenerationSnapshot == 0 {
			return errors.New("background task generation snapshot is missing")
		}
		if run.PolicyGenerationSnapshot != task.PolicyGenerationSnapshot || run.AgentGenerationSnapshot != task.AgentGenerationSnapshot {
			return errors.New("background task parent run snapshot changed")
		}
		if strings.TrimSpace(run.ToolCatalogDigest) != strings.TrimSpace(task.ToolCatalogDigest) || strings.TrimSpace(run.WorkspaceFingerprint) != strings.TrimSpace(task.WorkspaceFingerprint) {
			return errors.New("background task parent tool or workspace snapshot changed")
		}
		if strings.TrimSpace(run.PermissionModeCap) != strings.TrimSpace(task.PermissionModeCap) {
			return errors.New("background task permission cap changed")
		}
	}

	if snapshot, configured, err := r.currentPlanSnapshot(ctx, agent.ID); err != nil {
		return fmt.Errorf("load background task safety snapshot: %w", err)
	} else if configured {
		if task.PolicyGenerationSnapshot > 0 && snapshot.PolicyGenerationSnapshot != task.PolicyGenerationSnapshot {
			return errors.New("background task policy snapshot is stale")
		}
		if task.AgentGenerationSnapshot > 0 && snapshot.AgentGenerationSnapshot != task.AgentGenerationSnapshot {
			return errors.New("background task agent snapshot is stale")
		}
		if digest := strings.TrimSpace(task.ToolCatalogDigest); digest != "" && snapshot.ToolCatalogDigest != digest {
			return errors.New("background task tool catalog is stale")
		}
		if fingerprint := strings.TrimSpace(task.WorkspaceFingerprint); fingerprint != "" && snapshot.WorkspaceFingerprint != fingerprint {
			return errors.New("background task workspace changed")
		}
	}

	var scope struct {
		CWD string `json:"cwd"`
	}
	if len(task.PayloadJSON) > 0 && json.Unmarshal(task.PayloadJSON, &scope) == nil {
		if cwd := strings.TrimSpace(scope.CWD); cwd != "" && cwd != strings.TrimSpace(agent.CWD) {
			return errors.New("background task cwd changed")
		}
	}
	return nil
}
