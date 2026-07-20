package db

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"

	"autoto/internal/secrets"
	"autoto/internal/skills"
)

// revalidateSkills closes the upgrade gap between scanner releases. A metadata-
// only pass selects stale or internally inconsistent rows, then only those full
// templates are normalized and scanned. A changed risky result loses its enabled
// state and acknowledgement, requiring an explicit new confirmation.
func (s *Store) revalidateSkills(ctx context.Context) error {
	stored, err := s.listSkillsForRevalidation(ctx)
	if err != nil {
		return fmt.Errorf("list skills for revalidation: %w", err)
	}
	if len(stored) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin skill revalidation: %w", err)
	}
	defer tx.Rollback()

	for _, skill := range stored {
		// Derive metadata with state disabled first: a historical safe record may
		// now scan as review/blocked and therefore lacks a valid acknowledgement.
		candidate := skill
		candidate.Enabled = false
		candidate.RiskAcknowledgedAt = ""
		candidate.RiskAcknowledgedBy = ""
		candidate.RiskAcknowledgedHash = ""
		canonical, err := canonicalSkillRecord(candidate)
		if err != nil {
			if err := failClosedSkillRevalidation(ctx, tx, skill, "Stored content can no longer be normalized safely."); err != nil {
				return err
			}
			continue
		}
		metadataConsistent := canonical.Name == skill.Name &&
			canonical.Command == skill.Command &&
			canonical.Description == skill.Description &&
			canonical.Prompt == skill.Prompt &&
			canonical.ContentHash == skill.ContentHash &&
			canonical.ScanVerdict == skill.ScanVerdict &&
			string(canonical.ScanFindings) == string(skill.ScanFindings)
		canonical.ScannerVersion = skills.ScannerVersion
		keepEnabled := skill.Enabled && metadataConsistent && (canonical.ScanVerdict == skills.VerdictSafe ||
			(canonical.ScanVerdict == skills.VerdictReview && validSkillRiskAcknowledgement(skill)))
		canonical.Enabled = keepEnabled
		if keepEnabled && canonical.ScanVerdict == skills.VerdictReview {
			canonical.RiskAcknowledgedAt = strings.TrimSpace(skill.RiskAcknowledgedAt)
			canonical.RiskAcknowledgedBy = strings.TrimSpace(skill.RiskAcknowledgedBy)
			canonical.RiskAcknowledgedHash = strings.TrimSpace(skill.RiskAcknowledgedHash)
		} else {
			canonical.RiskAcknowledgedAt = ""
			canonical.RiskAcknowledgedBy = ""
			canonical.RiskAcknowledgedHash = ""
		}
		stateChanged := canonical.Enabled != skill.Enabled ||
			canonical.RiskAcknowledgedAt != skill.RiskAcknowledgedAt ||
			canonical.RiskAcknowledgedBy != skill.RiskAcknowledgedBy ||
			canonical.RiskAcknowledgedHash != skill.RiskAcknowledgedHash ||
			canonical.ScannerVersion != skill.ScannerVersion
		if metadataConsistent && !stateChanged {
			continue
		}
		canonical.UpdatedAt = nextSkillUpdatedAt(skill.UpdatedAt)
		canonical.RevisionNo = skill.RevisionNo + 1
		result, err := tx.ExecContext(ctx, `UPDATE skills SET name = ?, command = ?, description = ?, prompt = ?, source = ?, content_hash = ?, enabled = ?, scan_verdict = ?, scan_findings_json = ?, scanner_version = ?, risk_acknowledged_at = NULLIF(?, ''), risk_acknowledged_by = NULLIF(?, ''), risk_acknowledged_hash = NULLIF(?, ''), revision_no = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`, canonical.Name, canonical.Command, canonical.Description, canonical.Prompt, canonical.Source, canonical.ContentHash, boolInt(canonical.Enabled), canonical.ScanVerdict, string(canonical.ScanFindings), canonical.ScannerVersion, canonical.RiskAcknowledgedAt, canonical.RiskAcknowledgedBy, canonical.RiskAcknowledgedHash, canonical.RevisionNo, canonical.UpdatedAt, canonical.ID, skill.UpdatedAt)
		if err != nil {
			return fmt.Errorf("update revalidated skill %s: %w", skill.ID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("count revalidated skill %s: %w", skill.ID, err)
		}
		if affected == 0 {
			continue
		}
		if _, err := insertSkillRevision(ctx, tx, canonical, "revalidate", "scanner_revalidation", 0); err != nil {
			return fmt.Errorf("revision revalidated skill %s: %w", skill.ID, err)
		}
		if err := insertSkillAuditEvents(ctx, tx, canonical, &skill, "scanner_revalidation"); err != nil {
			return fmt.Errorf("audit revalidated skill %s: %w", skill.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit skill revalidation: %w", err)
	}
	return nil
}

// listSkillsForRevalidation deliberately permits invalid historical findings so
// one corrupt row can be disabled instead of preventing the service from opening.
func (s *Store) listSkillsForRevalidation(ctx context.Context) ([]Skill, error) {
	// The first pass deliberately excludes prompt and other full content. Store
	// writes keep content, hash, findings, and scanner_version atomic, so current,
	// internally consistent metadata can be trusted without rereading large prompts.
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, command, description, source, content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,'') FROM skills WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	candidateIDs := make([]string, 0)
	for rows.Next() {
		var candidate Skill
		var enabled int
		var findings string
		if err := rows.Scan(&candidate.ID, &candidate.Name, &candidate.Command, &candidate.Description, &candidate.Source, &candidate.ContentHash, &enabled, &candidate.ScanVerdict, &findings, &candidate.ScannerVersion, &candidate.RiskAcknowledgedAt, &candidate.RiskAcknowledgedBy, &candidate.RiskAcknowledgedHash); err != nil {
			rows.Close()
			return nil, err
		}
		candidate.Enabled = enabled != 0
		candidate.ScanFindings = json.RawMessage(findings)
		if skillNeedsRevalidation(candidate) {
			candidateIDs = append(candidateIDs, candidate.ID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	items := make([]Skill, 0, len(candidateIDs))
	for _, id := range candidateIDs {
		skill, err := scanSkillForRevalidation(func(dest ...any) error {
			return s.db.QueryRowContext(ctx, `SELECT id, name, command, description, prompt, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(deleted_at,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE id = ?`, id).Scan(dest...)
		})
		if err != nil {
			return nil, err
		}
		items = append(items, skill)
	}
	return items, nil
}

func scanSkillForRevalidation(scan skillScanner) (Skill, error) {
	var skill Skill
	var enabled int
	var findings string
	if err := scan(&skill.ID, &skill.Name, &skill.Command, &skill.Description, &skill.Prompt, &skill.Source, &skill.Scope, &skill.ProjectID, &skill.WorklineID, &skill.DeletedAt, &skill.RevisionNo, &skill.ContentHash, &enabled, &skill.ScanVerdict, &findings, &skill.ScannerVersion, &skill.RiskAcknowledgedAt, &skill.RiskAcknowledgedBy, &skill.RiskAcknowledgedHash, &skill.CreatedAt, &skill.UpdatedAt); err != nil {
		return Skill{}, err
	}
	skill.Enabled = enabled != 0
	skill.ScanFindings = json.RawMessage(findings)
	return skill, nil
}

func skillNeedsRevalidation(skill Skill) bool {
	if !validSkillName(skill.Name) || !validSkillCommand(skill.Command) || !validSkillDescription(skill.Description) || !validSkillSource(skill.Source) {
		return true
	}
	if skill.ScannerVersion != skills.ScannerVersion || len(skill.ContentHash) != 64 || !isLowerHex(skill.ContentHash) || !validSkillVerdict(skill.ScanVerdict) {
		return true
	}
	findingsVerdict, ok := storedSkillFindingsVerdict(skill.ScanFindings)
	if !ok || findingsVerdict != skill.ScanVerdict {
		return true
	}
	if skill.ScanVerdict == skills.VerdictBlocked && skill.Enabled {
		return true
	}
	hasAcknowledgement := strings.TrimSpace(skill.RiskAcknowledgedAt) != "" || strings.TrimSpace(skill.RiskAcknowledgedBy) != "" || strings.TrimSpace(skill.RiskAcknowledgedHash) != ""
	if skill.Enabled && skill.ScanVerdict == skills.VerdictReview {
		return !validSkillRiskAcknowledgement(skill)
	}
	return hasAcknowledgement
}

func failClosedSkillRevalidation(ctx context.Context, tx *sql.Tx, skill Skill, message string) error {
	findings, err := json.Marshal([]skills.Finding{{Code: "invalid_stored_skill", Severity: skills.VerdictBlocked, Message: message}})
	if err != nil {
		return err
	}
	updatedAt := nextSkillUpdatedAt(skill.UpdatedAt)
	revisionNo := skill.RevisionNo + 1
	result, err := tx.ExecContext(ctx, `UPDATE skills SET enabled = 0, scan_verdict = ?, scan_findings_json = ?, scanner_version = ?, risk_acknowledged_at = NULL, risk_acknowledged_by = NULL, risk_acknowledged_hash = NULL, revision_no = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`, skills.VerdictBlocked, string(findings), skills.ScannerVersion, revisionNo, updatedAt, skill.ID, skill.UpdatedAt)
	if err != nil {
		return fmt.Errorf("fail close revalidated skill %s: %w", skill.ID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count fail-closed skill %s: %w", skill.ID, err)
	}
	if affected == 0 {
		return nil
	}
	canonical := skill
	canonical.Enabled = false
	canonical.ScanVerdict = skills.VerdictBlocked
	canonical.ScanFindings = findings
	canonical.ScannerVersion = skills.ScannerVersion
	canonical.RiskAcknowledgedAt, canonical.RiskAcknowledgedBy, canonical.RiskAcknowledgedHash = "", "", ""
	canonical.UpdatedAt = updatedAt
	canonical.RevisionNo = revisionNo
	if _, err := insertSkillRevision(ctx, tx, canonical, "revalidate", "scanner_revalidation", 0); err != nil {
		return err
	}
	return insertSkillAuditEvents(ctx, tx, canonical, &skill, "scanner_revalidation")
}

func validStoredSkillFindings(raw json.RawMessage) bool {
	_, ok := storedSkillFindingsVerdict(raw)
	return ok
}

func storedSkillFindingsVerdict(raw json.RawMessage) (string, bool) {
	var findings []skills.Finding
	encoded := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(encoded, "[") || !json.Valid(raw) || json.Unmarshal(raw, &findings) != nil {
		return "", false
	}
	verdict := skills.VerdictSafe
	for _, finding := range findings {
		if strings.TrimSpace(finding.Code) == "" || strings.TrimSpace(finding.Message) == "" {
			return "", false
		}
		switch finding.Severity {
		case skills.VerdictReview:
			if verdict == skills.VerdictSafe {
				verdict = skills.VerdictReview
			}
		case skills.VerdictBlocked:
			verdict = skills.VerdictBlocked
		default:
			return "", false
		}
	}
	return verdict, true
}

func (s *Store) GetMessageDraft(ctx context.Context, userID, agentID string) (MessageDraft, error) {
	var draft MessageDraft
	err := s.db.QueryRowContext(ctx, `SELECT user_id, agent_id, content_text, version, updated_at FROM message_drafts WHERE user_id = ? AND agent_id = ?`, userID, agentID).Scan(&draft.UserID, &draft.AgentID, &draft.ContentText, &draft.Version, &draft.UpdatedAt)
	return draft, err
}

func (s *Store) PutMessageDraft(ctx context.Context, draft MessageDraft, expectedVersion int64) (MessageDraft, error) {
	if draft.UserID == "" || draft.AgentID == "" || expectedVersion < 0 || !utf8.ValidString(draft.ContentText) {
		return MessageDraft{}, errors.New("invalid message draft")
	}
	now := Now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MessageDraft{}, err
	}
	defer tx.Rollback()
	if expectedVersion == 0 {
		draft.Version, draft.UpdatedAt = 1, now
		result, err := tx.ExecContext(ctx, `INSERT INTO message_drafts (user_id, agent_id, content_text, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, agent_id) DO NOTHING`, draft.UserID, draft.AgentID, draft.ContentText, draft.Version, draft.UpdatedAt)
		if err != nil {
			return MessageDraft{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return MessageDraft{}, err
		}
		if affected != 1 {
			return MessageDraft{}, fmt.Errorf("%w: message draft was updated by another client", ErrConflict)
		}
	} else {
		draft.Version, draft.UpdatedAt = expectedVersion+1, now
		result, err := tx.ExecContext(ctx, `UPDATE message_drafts SET content_text = ?, version = ?, updated_at = ? WHERE user_id = ? AND agent_id = ? AND version = ?`, draft.ContentText, draft.Version, draft.UpdatedAt, draft.UserID, draft.AgentID, expectedVersion)
		if err != nil {
			return MessageDraft{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return MessageDraft{}, err
		}
		if affected != 1 {
			return MessageDraft{}, fmt.Errorf("%w: message draft was updated by another client", ErrConflict)
		}
	}
	if err := tx.Commit(); err != nil {
		return MessageDraft{}, err
	}
	return draft, nil
}

func (s *Store) DeleteMessageDraft(ctx context.Context, userID, agentID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM message_drafts WHERE user_id = ? AND agent_id = ?`, userID, agentID)
	return err
}

func DefaultNotificationSettings() NotificationSettings {
	now := Now()
	return NotificationSettings{ID: "default", NotifyOnApproval: true, NotifyOnDone: true, NotifyOnError: true, CreatedAt: now, UpdatedAt: now}
}

func (s *Store) GetNotificationSettings(ctx context.Context) (NotificationSettings, error) {
	settings, err := scanNotificationSettings(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, enabled, COALESCE(webhook_url,''), notify_on_approval, notify_on_done, notify_on_error, created_at, updated_at FROM notification_settings WHERE id = 'default'`).Scan(dest...)
	})
	if err == nil {
		return settings, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return NotificationSettings{}, err
	}
	settings = DefaultNotificationSettings()
	_, err = s.UpdateNotificationSettings(ctx, settings)
	return settings, err
}

func (s *Store) UpdateNotificationSettings(ctx context.Context, settings NotificationSettings) (NotificationSettings, error) {
	if settings.ID == "" {
		settings.ID = "default"
	}
	now := Now()
	if settings.CreatedAt == "" {
		settings.CreatedAt = now
	}
	settings.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO notification_settings (id, enabled, webhook_url, notify_on_approval, notify_on_done, notify_on_error, created_at, updated_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, webhook_url = excluded.webhook_url, notify_on_approval = excluded.notify_on_approval, notify_on_done = excluded.notify_on_done, notify_on_error = excluded.notify_on_error, updated_at = excluded.updated_at`, settings.ID, boolInt(settings.Enabled), strings.TrimSpace(settings.WebhookURL), boolInt(settings.NotifyOnApproval), boolInt(settings.NotifyOnDone), boolInt(settings.NotifyOnError), settings.CreatedAt, settings.UpdatedAt)
	if err != nil {
		return NotificationSettings{}, err
	}
	return s.GetNotificationSettings(ctx)
}

func DefaultWorkflowPreferences() WorkflowPreferences {
	now := Now()
	return WorkflowPreferences{ID: "default", RequireConfirmationForExec: true, RequireConfirmationForWrites: false, AllowReadOnlyByDefault: true, PolicyGeneration: 1, CreatedAt: now, UpdatedAt: now}
}

func (s *Store) GetWorkflowPreferences(ctx context.Context) (WorkflowPreferences, error) {
	prefs, err := scanWorkflowPreferences(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, require_confirmation_for_exec, require_confirmation_for_writes, allow_read_only_by_default, COALESCE(policy_generation,1), created_at, updated_at FROM workflow_preferences WHERE id = 'default'`).Scan(dest...)
	})
	if err == nil {
		return prefs, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WorkflowPreferences{}, err
	}
	prefs = DefaultWorkflowPreferences()
	return s.UpdateWorkflowPreferences(ctx, prefs)
}

func (s *Store) UpdateWorkflowPreferences(ctx context.Context, prefs WorkflowPreferences) (WorkflowPreferences, error) {
	if prefs.ID == "" {
		prefs.ID = "default"
	}
	now := Now()
	if prefs.CreatedAt == "" {
		prefs.CreatedAt = now
	}
	prefs.UpdatedAt = now
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkflowPreferences{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO workflow_preferences (id, require_confirmation_for_exec, require_confirmation_for_writes, allow_read_only_by_default, policy_generation, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET require_confirmation_for_exec = excluded.require_confirmation_for_exec, require_confirmation_for_writes = excluded.require_confirmation_for_writes, allow_read_only_by_default = excluded.allow_read_only_by_default, policy_generation = workflow_preferences.policy_generation + 1, updated_at = excluded.updated_at`, prefs.ID, boolInt(prefs.RequireConfirmationForExec), boolInt(prefs.RequireConfirmationForWrites), boolInt(prefs.AllowReadOnlyByDefault), prefs.CreatedAt, prefs.UpdatedAt)
	if err != nil {
		return WorkflowPreferences{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorkflowPreferences{}, err
	}
	return s.GetWorkflowPreferences(ctx)
}

func ensureWorkflowPreferencesTx(ctx context.Context, tx *sql.Tx) error {
	now := Now()
	_, err := tx.ExecContext(ctx, `INSERT INTO workflow_preferences (id, require_confirmation_for_exec, require_confirmation_for_writes, allow_read_only_by_default, policy_generation, created_at, updated_at) VALUES ('default', 1, 0, 1, 1, ?, ?) ON CONFLICT(id) DO NOTHING`, now, now)
	return err
}

func bumpPolicyGenerationTx(ctx context.Context, tx *sql.Tx) error {
	if err := ensureWorkflowPreferencesTx(ctx, tx); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE workflow_preferences SET policy_generation = policy_generation + 1, updated_at = ? WHERE id = 'default'`, Now())
	return err
}

const (
	maxStoredToolPermissionDescriptionBytes = 2000
	maxStoredToolPermissionPriority         = 10000
)

func normalizeStoredToolPermissionRule(rule ToolPermissionRule) (ToolPermissionRule, error) {
	rule.Mode = strings.TrimSpace(rule.Mode)
	rule.ToolName = strings.TrimSpace(rule.ToolName)
	rule.Risk = strings.TrimSpace(rule.Risk)
	rule.Decision = strings.TrimSpace(rule.Decision)
	rule.Description = strings.TrimSpace(rule.Description)
	if !validStoredToolPermissionMode(rule.Mode) {
		return ToolPermissionRule{}, errors.New("invalid tool permission mode")
	}
	if !validStoredToolPermissionToolName(rule.ToolName) {
		return ToolPermissionRule{}, errors.New("invalid tool permission tool name")
	}
	if !validStoredToolPermissionRisk(rule.Risk) {
		return ToolPermissionRule{}, errors.New("invalid tool permission risk")
	}
	if rule.Decision != "allow" && rule.Decision != "ask" && rule.Decision != "deny" {
		return ToolPermissionRule{}, errors.New("invalid tool permission decision")
	}
	if rule.Decision == "allow" && (rule.Risk == "danger" || rule.Risk == "*") {
		return ToolPermissionRule{}, errors.New("allow rules cannot target danger or wildcard risk")
	}
	if rule.Priority < -maxStoredToolPermissionPriority || rule.Priority > maxStoredToolPermissionPriority {
		return ToolPermissionRule{}, errors.New("tool permission priority is out of range")
	}
	if len(rule.Description) > maxStoredToolPermissionDescriptionBytes {
		return ToolPermissionRule{}, errors.New("tool permission description is too long")
	}
	return rule, nil
}

func validStoredToolPermissionMode(mode string) bool {
	switch mode {
	case "*", "readOnly", "bypassPermissions", "acceptEdits", "default", "dontAsk":
		return true
	default:
		return false
	}
}

func validStoredToolPermissionToolName(name string) bool {
	if name == "*" {
		return true
	}
	if len(name) == 0 || len(name) > 192 {
		return false
	}
	for i, r := range name {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (i > 0 && r >= '0' && r <= '9') || (i > 0 && strings.ContainsRune("_.:-", r)) {
			continue
		}
		return false
	}
	return true
}

func validStoredToolPermissionRisk(risk string) bool {
	switch risk {
	case "*", "read", "write", "exec", "danger":
		return true
	default:
		return false
	}
}

func (s *Store) ListToolPermissionRules(ctx context.Context) ([]ToolPermissionRule, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, mode, tool_name, risk, decision, priority, enabled, COALESCE(description,''), created_at, updated_at FROM tool_permission_rules ORDER BY priority DESC, (CASE WHEN mode <> '*' THEN 1 ELSE 0 END + CASE WHEN tool_name <> '*' THEN 1 ELSE 0 END + CASE WHEN risk <> '*' THEN 1 ELSE 0 END) DESC, CASE decision WHEN 'deny' THEN 2 WHEN 'ask' THEN 1 ELSE 0 END DESC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rules := make([]ToolPermissionRule, 0)
	for rows.Next() {
		rule, err := scanToolPermissionRule(rows.Scan)
		if err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func (s *Store) CreateToolPermissionRule(ctx context.Context, rule ToolPermissionRule) (ToolPermissionRule, error) {
	if rule.ID == "" {
		rule.ID = NewID()
	}
	now := Now()
	if rule.CreatedAt == "" {
		rule.CreatedAt = now
	}
	if rule.UpdatedAt == "" {
		rule.UpdatedAt = rule.CreatedAt
	}
	rule, err := normalizeStoredToolPermissionRule(rule)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO tool_permission_rules (id, mode, tool_name, risk, decision, priority, enabled, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?)`, rule.ID, rule.Mode, rule.ToolName, rule.Risk, rule.Decision, rule.Priority, boolInt(rule.Enabled), rule.Description, rule.CreatedAt, rule.UpdatedAt)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	if err := bumpPolicyGenerationTx(ctx, tx); err != nil {
		return ToolPermissionRule{}, err
	}
	if err := tx.Commit(); err != nil {
		return ToolPermissionRule{}, err
	}
	return s.GetToolPermissionRule(ctx, rule.ID)
}

func (s *Store) GetToolPermissionRule(ctx context.Context, id string) (ToolPermissionRule, error) {
	return scanToolPermissionRule(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, mode, tool_name, risk, decision, priority, enabled, COALESCE(description,''), created_at, updated_at FROM tool_permission_rules WHERE id = ?`, id).Scan(dest...)
	})
}

func (s *Store) UpdateToolPermissionRule(ctx context.Context, rule ToolPermissionRule) (ToolPermissionRule, error) {
	if strings.TrimSpace(rule.ID) == "" {
		return ToolPermissionRule{}, errors.New("tool permission rule id is required")
	}
	existing, err := s.GetToolPermissionRule(ctx, rule.ID)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	rule.CreatedAt = existing.CreatedAt
	rule.UpdatedAt = Now()
	rule, err = normalizeStoredToolPermissionRule(rule)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE tool_permission_rules SET mode = ?, tool_name = ?, risk = ?, decision = ?, priority = ?, enabled = ?, description = NULLIF(?, ''), updated_at = ? WHERE id = ?`, rule.Mode, rule.ToolName, rule.Risk, rule.Decision, rule.Priority, boolInt(rule.Enabled), rule.Description, rule.UpdatedAt, rule.ID)
	if err != nil {
		return ToolPermissionRule{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return ToolPermissionRule{}, err
	} else if affected != 1 {
		return ToolPermissionRule{}, sql.ErrNoRows
	}
	if err := bumpPolicyGenerationTx(ctx, tx); err != nil {
		return ToolPermissionRule{}, err
	}
	if err := tx.Commit(); err != nil {
		return ToolPermissionRule{}, err
	}
	return s.GetToolPermissionRule(ctx, rule.ID)
}

func (s *Store) DeleteToolPermissionRule(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `DELETE FROM tool_permission_rules WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return sql.ErrNoRows
	}
	if err := bumpPolicyGenerationTx(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) AddMessage(ctx context.Context, msg Message) (Message, error) {
	return s.AddMessageWithAttachments(ctx, msg, msg.Attachments)
}

func (s *Store) AssignMessageRun(ctx context.Context, agentID, messageID, runID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_messages SET run_id = NULLIF(?, '') WHERE agent_id = ? AND id = ?`, runID, agentID, messageID)
	return err
}

func (s *Store) AddMessageWithAttachments(ctx context.Context, msg Message, attachments []Attachment) (Message, error) {
	if msg.ID == "" {
		msg.ID = NewID()
	}
	if msg.CreatedAt == "" {
		msg.CreatedAt = Now()
	}
	if msg.ContentJSON == nil && msg.ContentText != "" {
		content, _ := json.Marshal([]map[string]string{{"type": "text", "text": msg.ContentText}})
		msg.ContentJSON = content
	}
	turnUsageJSON := ""
	if msg.TurnUsage != nil {
		encoded, err := json.Marshal(msg.TurnUsage)
		if err != nil {
			return Message{}, err
		}
		turnUsageJSON = string(encoded)
	}
	createdBy := msg.CreatedBy
	if createdBy == "api" {
		createdBy = ""
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_messages (id, agent_id, run_id, parent_tool_use_id, role, content_json, provider_state_json, content_text, turn_usage_json, command_text, correction_of_message_id, created_by, completion_state, stop_reason, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?)`, msg.ID, msg.AgentID, msg.RunID, nullEmpty(msg.ParentToolID), msg.Role, string(msg.ContentJSON), string(msg.ProviderStateJSON), msg.ContentText, turnUsageJSON, nullEmpty(msg.CommandText), msg.CorrectionOfMessageID, createdBy, msg.CompletionState, msg.StopReason, msg.CreatedAt); err != nil {
		return Message{}, err
	}
	storedAttachments := make([]Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.ID == "" {
			attachment.ID = NewID()
		}
		attachment.MessageID = msg.ID
		attachment.AgentID = msg.AgentID
		if attachment.CreatedAt == "" {
			attachment.CreatedAt = msg.CreatedAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO agent_message_attachments (id, message_id, agent_id, filename, mime_type, kind, size_bytes, data_blob, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, attachment.ID, attachment.MessageID, attachment.AgentID, attachment.Filename, attachment.MIMEType, attachment.Kind, attachment.SizeBytes, attachment.Data, attachment.ExtractedText, attachment.CreatedAt); err != nil {
			return Message{}, err
		}
		storedAttachments = append(storedAttachments, attachment)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?`, msg.CreatedAt, msg.CreatedAt, msg.AgentID); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	msg.Attachments = attachmentMetadata(storedAttachments)
	return msg, nil
}

// CreateCorrectionWithRun creates a new user message instead of modifying its
// source. Retained attachments are copied into new rows so the original message
// remains immutable even if the correction is later deleted.
func (s *Store) CreateCorrectionWithRun(ctx context.Context, agentID, sourceMessageID, contentText, commandText, createdBy string, keepAttachmentIDs []string, attachments []Attachment) (Message, Run, error) {
	if strings.TrimSpace(contentText) == "" && len(keepAttachmentIDs) == 0 && len(attachments) == 0 {
		return Message{}, Run{}, errors.New("text, files, or keepAttachmentIds is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, Run{}, err
	}
	defer tx.Rollback()
	var role string
	if err := tx.QueryRowContext(ctx, `SELECT role FROM agent_messages WHERE id = ? AND agent_id = ?`, sourceMessageID, agentID).Scan(&role); err != nil {
		return Message{}, Run{}, err
	}
	if role != "user" {
		return Message{}, Run{}, fmt.Errorf("%w: corrections require a user source message", ErrConflict)
	}

	retained := make([]Attachment, 0, len(keepAttachmentIDs))
	seen := make(map[string]struct{}, len(keepAttachmentIDs))
	for _, attachmentID := range keepAttachmentIDs {
		if attachmentID == "" {
			return Message{}, Run{}, errors.New("invalid keepAttachmentIds")
		}
		if _, ok := seen[attachmentID]; ok {
			return Message{}, Run{}, errors.New("duplicate keepAttachmentIds")
		}
		seen[attachmentID] = struct{}{}
		var attachment Attachment
		if err := tx.QueryRowContext(ctx, `SELECT id, message_id, agent_id, filename, COALESCE(mime_type,''), kind, size_bytes, data_blob, COALESCE(extracted_text,''), created_at FROM agent_message_attachments WHERE id = ? AND message_id = ? AND agent_id = ?`, attachmentID, sourceMessageID, agentID).Scan(&attachment.ID, &attachment.MessageID, &attachment.AgentID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &attachment.Data, &attachment.ExtractedText, &attachment.CreatedAt); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return Message{}, Run{}, fmt.Errorf("%w: attachment does not belong to source message", ErrConflict)
			}
			return Message{}, Run{}, err
		}
		attachment.ID = ""
		retained = append(retained, attachment)
	}

	now := Now()
	message := Message{ID: NewID(), AgentID: agentID, Role: "user", ContentText: contentText, CommandText: commandText, CorrectionOfMessageID: sourceMessageID, CreatedBy: createdBy, CreatedAt: now}
	if message.ContentText != "" {
		content, _ := json.Marshal([]map[string]string{{"type": "text", "text": message.ContentText}})
		message.ContentJSON = content
	}
	if createdBy == "api" {
		createdBy = ""
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_messages (id, agent_id, role, content_json, content_text, command_text, correction_of_message_id, created_by, created_at) VALUES (?, ?, 'user', ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?)`, message.ID, message.AgentID, string(message.ContentJSON), message.ContentText, message.CommandText, sourceMessageID, createdBy, message.CreatedAt); err != nil {
		return Message{}, Run{}, err
	}

	allAttachments := append(retained, attachments...)
	storedAttachments := make([]Attachment, 0, len(allAttachments))
	for _, attachment := range allAttachments {
		if attachment.ID == "" {
			attachment.ID = NewID()
		}
		attachment.MessageID = message.ID
		attachment.AgentID = agentID
		if attachment.CreatedAt == "" {
			attachment.CreatedAt = now
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO agent_message_attachments (id, message_id, agent_id, filename, mime_type, kind, size_bytes, data_blob, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, attachment.ID, attachment.MessageID, attachment.AgentID, attachment.Filename, attachment.MIMEType, attachment.Kind, attachment.SizeBytes, attachment.Data, attachment.ExtractedText, attachment.CreatedAt); err != nil {
			return Message{}, Run{}, err
		}
		storedAttachments = append(storedAttachments, attachment)
	}
	run := Run{ID: NewID(), AgentID: agentID, TriggerMessageID: message.ID, Status: "pending", CheckpointState: RunCheckpointNone, CreatedAt: now, UpdatedAt: now}
	if _, err := tx.ExecContext(ctx, `INSERT INTO runs (id, agent_id, trigger_message_id, status, checkpoint_state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`, run.ID, run.AgentID, run.TriggerMessageID, run.CheckpointState, run.CreatedAt, run.UpdatedAt); err != nil {
		return Message{}, Run{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agent_messages SET run_id = ? WHERE id = ? AND agent_id = ?`, run.ID, message.ID, agentID); err != nil {
		return Message{}, Run{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?`, now, now, agentID); err != nil {
		return Message{}, Run{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, Run{}, err
	}
	message.RunID = run.ID
	message.Attachments = attachmentMetadata(storedAttachments)
	return message, run, nil
}

func (s *Store) ListMessages(ctx context.Context, agentID string) ([]Message, error) {
	messages, err := s.listMessages(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if err := s.populateMessageAttachments(ctx, messages, false); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *Store) ListMessagesPage(ctx context.Context, agentID, before string, limit int) (MessagePage, error) {
	if limit <= 0 {
		limit = DefaultMessagePageLimit
	}
	if limit > MaxMessagePageLimit {
		limit = MaxMessagePageLimit
	}
	cursor, err := decodeMessageCursor(before)
	if err != nil {
		return MessagePage{}, err
	}
	query := `SELECT id, agent_id, COALESCE(run_id,''), role, COALESCE(content_json,''), COALESCE(provider_state_json,''), COALESCE(content_text,''), COALESCE(turn_usage_json,''), COALESCE(parent_tool_use_id,''), COALESCE(command_text,''), COALESCE(correction_of_message_id,''), COALESCE(created_by,''), COALESCE(completion_state,''), COALESCE(stop_reason,''), created_at FROM agent_messages WHERE agent_id = ?`
	args := []any{agentID}
	if cursor.ID != "" {
		query += ` AND (created_at < ? OR (created_at = ? AND id < ?))`
		args = append(args, cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return MessagePage{}, err
	}
	messages, err := scanMessages(rows)
	if err != nil {
		return MessagePage{}, err
	}
	page := MessagePage{Messages: messages}
	if len(page.Messages) > limit {
		page.HasMoreBefore = true
		page.Messages = page.Messages[:limit]
	}
	for i, j := 0, len(page.Messages)-1; i < j; i, j = i+1, j-1 {
		page.Messages[i], page.Messages[j] = page.Messages[j], page.Messages[i]
	}
	if page.HasMoreBefore && len(page.Messages) > 0 {
		page.NextBefore, err = encodeMessageCursor(messageCursor{CreatedAt: page.Messages[0].CreatedAt, ID: page.Messages[0].ID})
		if err != nil {
			return MessagePage{}, err
		}
	}
	if err := s.populateMessageAttachments(ctx, page.Messages, false); err != nil {
		return MessagePage{}, err
	}
	return page, nil
}

func (s *Store) ListMessagesWithAttachmentData(ctx context.Context, agentID string) ([]Message, error) {
	messages, err := s.listMessages(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if err := s.populateMessageAttachments(ctx, messages, true); err != nil {
		return nil, err
	}
	return messages, nil
}

type messageCursor struct {
	CreatedAt string `json:"createdAt"`
	ID        string `json:"id"`
}

func encodeMessageCursor(cursor messageCursor) (string, error) {
	data, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodeMessageCursor(value string) (messageCursor, error) {
	if strings.TrimSpace(value) == "" {
		return messageCursor{}, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return messageCursor{}, ErrInvalidCursor
	}
	var cursor messageCursor
	if err := json.Unmarshal(data, &cursor); err != nil || cursor.CreatedAt == "" || cursor.ID == "" {
		return messageCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}

func (s *Store) listMessages(ctx context.Context, agentID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), role, COALESCE(content_json,''), COALESCE(provider_state_json,''), COALESCE(content_text,''), COALESCE(turn_usage_json,''), COALESCE(parent_tool_use_id,''), COALESCE(command_text,''), COALESCE(correction_of_message_id,''), COALESCE(created_by,''), COALESCE(completion_state,''), COALESCE(stop_reason,''), created_at FROM agent_messages WHERE agent_id = ? ORDER BY created_at ASC, id ASC`, agentID)
	if err != nil {
		return nil, err
	}
	return scanMessages(rows)
}

func scanMessages(rows *sql.Rows) ([]Message, error) {
	defer rows.Close()
	messages := make([]Message, 0)
	for rows.Next() {
		var m Message
		var raw, providerState, turnUsage string
		if err := rows.Scan(&m.ID, &m.AgentID, &m.RunID, &m.Role, &raw, &providerState, &m.ContentText, &turnUsage, &m.ParentToolID, &m.CommandText, &m.CorrectionOfMessageID, &m.CreatedBy, &m.CompletionState, &m.StopReason, &m.CreatedAt); err != nil {
			return nil, err
		}
		if raw != "" {
			m.ContentJSON = json.RawMessage(raw)
		}
		if providerState != "" {
			m.ProviderStateJSON = json.RawMessage(providerState)
		}
		if turnUsage != "" {
			var usage MessageTurnUsage
			if json.Unmarshal([]byte(turnUsage), &usage) == nil {
				m.TurnUsage = &usage
			}
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

func (s *Store) populateMessageAttachments(ctx context.Context, messages []Message, includeData bool) error {
	for i := range messages {
		attachments, err := s.ListMessageAttachments(ctx, messages[i].ID, includeData)
		if err != nil {
			return err
		}
		messages[i].Attachments = attachments
	}
	return nil
}

func (s *Store) ListMessageAttachments(ctx context.Context, messageID string, includeData bool) ([]Attachment, error) {
	selectData := `X''`
	selectText := `''`
	if includeData {
		selectData = `data_blob`
		selectText = `COALESCE(extracted_text,'')`
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, message_id, agent_id, filename, COALESCE(mime_type,''), kind, size_bytes, `+selectData+`, `+selectText+`, created_at FROM agent_message_attachments WHERE message_id = ? ORDER BY created_at ASC`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attachments := make([]Attachment, 0)
	for rows.Next() {
		var attachment Attachment
		var data []byte
		if err := rows.Scan(&attachment.ID, &attachment.MessageID, &attachment.AgentID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &data, &attachment.ExtractedText, &attachment.CreatedAt); err != nil {
			return nil, err
		}
		if includeData {
			attachment.Data = data
		}
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func (s *Store) GetAttachment(ctx context.Context, agentID, messageID, attachmentID string) (Attachment, error) {
	var attachment Attachment
	err := s.db.QueryRowContext(ctx, `SELECT id, message_id, agent_id, filename, COALESCE(mime_type,''), kind, size_bytes, data_blob, COALESCE(extracted_text,''), created_at FROM agent_message_attachments WHERE agent_id = ? AND message_id = ? AND id = ?`, agentID, messageID, attachmentID).Scan(&attachment.ID, &attachment.MessageID, &attachment.AgentID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &attachment.Data, &attachment.ExtractedText, &attachment.CreatedAt)
	return attachment, err
}

func attachmentMetadata(attachments []Attachment) []Attachment {
	if len(attachments) == 0 {
		return nil
	}
	out := make([]Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		attachment.Data = nil
		attachment.ExtractedText = ""
		out = append(out, attachment)
	}
	return out
}

func (s *Store) AddToolCall(ctx context.Context, call ToolCall) (ToolCall, error) {
	if call.ID == "" {
		call.ID = NewID()
	}
	if call.CreatedAt == "" {
		call.CreatedAt = Now()
	}
	if call.UpdatedAt == "" {
		call.UpdatedAt = call.CreatedAt
	}
	if call.PermissionGeneration < 1 {
		call.PermissionGeneration = 1
	}
	if call.PolicyGeneration < 1 {
		call.PolicyGeneration = 1
	}
	switch call.Status {
	case "pending_approval", "approved":
		call.StartedAt = ""
		call.CompletedAt = ""
	case "running":
		if call.StartedAt == "" {
			call.StartedAt = call.CreatedAt
		}
		call.CompletedAt = ""
	case "completed", "error", "succeeded", "failed":
		if call.StartedAt == "" {
			call.StartedAt = call.CreatedAt
		}
		if call.CompletedAt == "" {
			call.CompletedAt = call.CreatedAt
		}
	case "denied":
		call.StartedAt = ""
		if call.CompletedAt == "" {
			call.CompletedAt = call.CreatedAt
		}
	default:
		return ToolCall{}, fmt.Errorf("invalid tool call status %q", call.Status)
	}
	call.ExecutionDeviceID = strings.TrimSpace(call.ExecutionDeviceID)
	if call.ExecutionDeviceID == "" && strings.TrimSpace(call.RunID) != "" {
		if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(execution_device_id,'local') FROM runs WHERE id = ? AND agent_id = ?`, call.RunID, call.AgentID).Scan(&call.ExecutionDeviceID); err != nil {
			return ToolCall{}, err
		}
	}
	if call.ExecutionDeviceID == "" {
		if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(execution_device_id,'local') FROM agents WHERE id = ?`, call.AgentID).Scan(&call.ExecutionDeviceID); err != nil {
			return ToolCall{}, err
		}
	}
	if err := validateP2P3Text("tool call execution device id", call.ExecutionDeviceID, 128, true, false); err != nil {
		return ToolCall{}, err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_tool_calls (id, agent_id, run_id, message_id, tool_use_id, tool_name, input_json, output_json, status, duration_ms, error_message, permission_decided_by, permission_decided_at, permission_deny_message, permission_decision_reason, permission_suggestions, permission_generation, policy_generation, execution_device_id, started_at, completed_at, created_at, updated_at) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)`, call.ID, call.AgentID, call.RunID, call.MessageID, call.ToolUseID, call.ToolName, string(call.InputJSON), string(call.OutputJSON), call.Status, call.DurationMS, call.ErrorMessage, call.PermissionDecidedBy, call.PermissionDecidedAt, call.PermissionDenyMessage, call.PermissionDecisionReason, call.PermissionSuggestions, call.PermissionGeneration, call.PolicyGeneration, call.ExecutionDeviceID, call.StartedAt, call.CompletedAt, call.CreatedAt, call.UpdatedAt)
	if err != nil {
		return ToolCall{}, err
	}
	return call, nil
}

func (s *Store) GetToolCallByUseID(ctx context.Context, agentID, toolUseID string) (ToolCall, error) {
	var c ToolCall
	var input, output string
	err := s.db.QueryRowContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(permission_deny_message,''), COALESCE(permission_decision_reason,''), COALESCE(permission_suggestions,''), COALESCE(permission_generation,1), COALESCE(policy_generation,1), COALESCE(execution_device_id,'local'), COALESCE(started_at,''), COALESCE(completed_at,''), created_at, COALESCE(updated_at, created_at) FROM agent_tool_calls WHERE agent_id = ? AND tool_use_id = ?`, agentID, toolUseID).Scan(&c.ID, &c.AgentID, &c.RunID, &c.MessageID, &c.ToolUseID, &c.ToolName, &input, &output, &c.Status, &c.DurationMS, &c.ErrorMessage, &c.PermissionDecidedBy, &c.PermissionDecidedAt, &c.PermissionDenyMessage, &c.PermissionDecisionReason, &c.PermissionSuggestions, &c.PermissionGeneration, &c.PolicyGeneration, &c.ExecutionDeviceID, &c.StartedAt, &c.CompletedAt, &c.CreatedAt, &c.UpdatedAt)
	if input != "" {
		c.InputJSON = json.RawMessage(input)
	}
	if output != "" {
		c.OutputJSON = json.RawMessage(output)
	}
	return c, err
}

func (s *Store) UpdateToolCallApproval(ctx context.Context, agentID, toolUseID, status, decidedBy, denyMessage, reason, suggestions string) error {
	if status != "approved" && status != "denied" {
		return fmt.Errorf("invalid tool approval status %q", status)
	}
	decidedAt := Now()
	completedAt := ""
	if status == "denied" {
		completedAt = decidedAt
	}
	_, err := s.db.ExecContext(ctx, `UPDATE agent_tool_calls SET status = ?, completed_at = COALESCE(NULLIF(completed_at, ''), NULLIF(?, '')), permission_decided_by = NULLIF(?, ''), permission_decided_at = ?, permission_deny_message = NULLIF(?, ''), permission_decision_reason = NULLIF(?, ''), permission_suggestions = NULLIF(?, ''), updated_at = ? WHERE agent_id = ? AND tool_use_id = ? AND status = 'pending_approval'`, status, completedAt, decidedBy, decidedAt, denyMessage, reason, suggestions, decidedAt, agentID, toolUseID)
	return err
}

// MarkToolCallRunning claims an approved pending call immediately before execution.
func (s *Store) MarkToolCallRunning(ctx context.Context, agentID, toolUseID string) error {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_tool_calls SET status = 'running', started_at = COALESCE(NULLIF(started_at, ''), ?), completed_at = NULL, updated_at = ? WHERE agent_id = ? AND tool_use_id = ? AND status = 'approved'`, now, now, agentID, toolUseID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		return nil
	}
	return fmt.Errorf("%w: tool call cannot start: %s", ErrConflict, toolUseID)
}

func (s *Store) UpdateToolCallResult(ctx context.Context, agentID, toolUseID string, outputJSON json.RawMessage, status string, durationMS int64, errorMessage string) error {
	if status != "completed" && status != "error" && status != "denied" {
		return fmt.Errorf("invalid terminal tool call status %q", status)
	}
	now := Now()
	_, err := s.db.ExecContext(ctx, `UPDATE agent_tool_calls SET output_json = ?, status = ?, duration_ms = ?, completed_at = COALESCE(NULLIF(completed_at, ''), ?), error_message = NULLIF(?, ''), updated_at = ? WHERE agent_id = ? AND tool_use_id = ?`, string(outputJSON), status, durationMS, now, errorMessage, now, agentID, toolUseID)
	return err
}

func (s *Store) ListPendingToolCalls(ctx context.Context, agentID string) ([]ToolCall, error) {
	return s.listToolCalls(ctx, `WHERE agent_id = ? AND status = 'pending_approval' ORDER BY created_at ASC`, agentID)
}

func (s *Store) ListToolCallsByRun(ctx context.Context, agentID, runID string) ([]ToolCall, error) {
	return s.listToolCalls(ctx, `WHERE agent_id = ? AND run_id = ? ORDER BY created_at ASC, id ASC`, agentID, runID)
}

func (s *Store) ListToolCallsByRunWindow(ctx context.Context, agentID, runID string, limit, offset int) ([]ToolCall, error) {
	if limit <= 0 || offset < 0 {
		return nil, fmt.Errorf("invalid tool call window limit=%d offset=%d", limit, offset)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(execution_device_id,'local'), COALESCE(started_at,''), COALESCE(completed_at,''), created_at, COALESCE(updated_at, created_at) FROM agent_tool_calls WHERE agent_id = ? AND run_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, agentID, runID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	calls := make([]ToolCall, 0, limit)
	for rows.Next() {
		var call ToolCall
		var input, output string
		if err := rows.Scan(&call.ID, &call.AgentID, &call.RunID, &call.MessageID, &call.ToolUseID, &call.ToolName, &input, &output, &call.Status, &call.DurationMS, &call.ErrorMessage, &call.ExecutionDeviceID, &call.StartedAt, &call.CompletedAt, &call.CreatedAt, &call.UpdatedAt); err != nil {
			return nil, err
		}
		if input != "" {
			call.InputJSON = json.RawMessage(input)
		}
		if output != "" {
			call.OutputJSON = json.RawMessage(output)
		}
		calls = append(calls, call)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for left, right := 0, len(calls)-1; left < right; left, right = left+1, right-1 {
		calls[left], calls[right] = calls[right], calls[left]
	}
	return calls, nil
}

func (s *Store) listToolCalls(ctx context.Context, where string, args ...any) ([]ToolCall, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(permission_deny_message,''), COALESCE(permission_decision_reason,''), COALESCE(permission_suggestions,''), COALESCE(permission_generation,1), COALESCE(policy_generation,1), COALESCE(execution_device_id,'local'), COALESCE(started_at,''), COALESCE(completed_at,''), created_at, COALESCE(updated_at, created_at) FROM agent_tool_calls `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	calls := make([]ToolCall, 0)
	for rows.Next() {
		var c ToolCall
		var input, output string
		if err := rows.Scan(&c.ID, &c.AgentID, &c.RunID, &c.MessageID, &c.ToolUseID, &c.ToolName, &input, &output, &c.Status, &c.DurationMS, &c.ErrorMessage, &c.PermissionDecidedBy, &c.PermissionDecidedAt, &c.PermissionDenyMessage, &c.PermissionDecisionReason, &c.PermissionSuggestions, &c.PermissionGeneration, &c.PolicyGeneration, &c.ExecutionDeviceID, &c.StartedAt, &c.CompletedAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if input != "" {
			c.InputJSON = json.RawMessage(input)
		}
		if output != "" {
			c.OutputJSON = json.RawMessage(output)
		}
		calls = append(calls, c)
	}
	return calls, rows.Err()
}

func (s *Store) RunSummary(ctx context.Context, agentID, runID string) (RunSummary, error) {
	run, err := s.GetRun(ctx, agentID, runID)
	if err != nil {
		return RunSummary{}, err
	}
	summary := RunSummary{Run: run}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_messages WHERE agent_id = ? AND run_id = ?`, agentID, runID).Scan(&summary.MessageCount); err != nil {
		return RunSummary{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),0) FROM agent_tool_calls WHERE agent_id = ? AND run_id = ?`, agentID, runID).Scan(&summary.ToolCallCount, &summary.PendingApprovals, &summary.DeniedToolCalls, &summary.ErrorToolCalls); err != nil {
		return RunSummary{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0) FROM api_requests WHERE agent_id = ? AND run_id = ?`, agentID, runID).Scan(&summary.APIRequestCount, &summary.InputTokens, &summary.OutputTokens, &summary.CostUSD); err != nil {
		return RunSummary{}, err
	}
	summary.ToolCalls, err = s.listToolCallPreviewsByRun(ctx, agentID, runID, 12)
	if err != nil {
		return RunSummary{}, err
	}
	summary.RecentMessages, err = s.listRunMessagePreviews(ctx, agentID, runID, 6)
	if err != nil {
		return RunSummary{}, err
	}
	return summary, nil
}

func (s *Store) ActiveRunSummary(ctx context.Context, agentID string) (ActiveRunSummary, error) {
	var summary ActiveRunSummary
	run, err := scanRun(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, runSelectSQL+` WHERE agent_id = ? AND status IN ('pending', 'running', 'continuation_pending') ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'continuation_pending' THEN 1 ELSE 2 END, COALESCE(started_at, created_at) DESC, id DESC LIMIT 1`, agentID).Scan(dest...)
	})
	if err != nil {
		return ActiveRunSummary{}, err
	}
	summary.Run = run
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_messages WHERE agent_id = ? AND run_id = ?`, agentID, summary.Run.ID).Scan(&summary.MessageCount); err != nil {
		return ActiveRunSummary{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END),0) FROM agent_tool_calls WHERE agent_id = ? AND run_id = ?`, agentID, summary.Run.ID).Scan(&summary.ToolCallCount, &summary.PendingApprovals); err != nil {
		return ActiveRunSummary{}, err
	}
	summary.ToolCalls, err = s.listToolCallPreviewsByRun(ctx, agentID, summary.Run.ID, 6)
	if err != nil {
		return ActiveRunSummary{}, err
	}
	return summary, nil
}

func (s *Store) listToolCallPreviewsByRun(ctx context.Context, agentID, runID string, limit int) ([]ToolCallPreview, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(started_at,''), COALESCE(completed_at,''), created_at, COALESCE(updated_at, created_at) FROM agent_tool_calls WHERE agent_id = ? AND run_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, agentID, runID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	calls := make([]ToolCallPreview, 0)
	for rows.Next() {
		var call ToolCallPreview
		if err := rows.Scan(&call.ID, &call.RunID, &call.MessageID, &call.ToolUseID, &call.ToolName, &call.Status, &call.DurationMS, &call.ErrorMessage, &call.PermissionDecidedBy, &call.PermissionDecidedAt, &call.StartedAt, &call.CompletedAt, &call.CreatedAt, &call.UpdatedAt); err != nil {
			return nil, err
		}
		calls = append(calls, call)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(calls)-1; i < j; i, j = i+1, j-1 {
		calls[i], calls[j] = calls[j], calls[i]
	}
	return calls, nil
}

func (s *Store) listRunMessagePreviews(ctx context.Context, agentID, runID string, limit int) ([]RunMessagePreview, error) {
	if limit <= 0 || limit > 20 {
		limit = 6
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, role, COALESCE(content_text,''), COALESCE(parent_tool_use_id,''), created_at FROM agent_messages WHERE agent_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT ?`, agentID, runID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]RunMessagePreview, 0)
	for rows.Next() {
		var message RunMessagePreview
		if err := rows.Scan(&message.ID, &message.Role, &message.ContentText, &message.ParentToolID, &message.CreatedAt); err != nil {
			return nil, err
		}
		message.ContentText = truncateRunes(message.ContentText, 280)
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, nil
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func (s *Store) AddAPIRequest(ctx context.Context, request APIRequest) (APIRequest, error) {
	if request.ID == "" {
		request.ID = NewID()
	}
	if request.CreatedAt == "" {
		request.CreatedAt = Now()
	}
	if request.Kind == "" {
		request.Kind = "model"
	}
	if request.TurnIndex < 0 || request.ContinuationIndex < 0 {
		return APIRequest{}, errors.New("api request turn indexes must not be negative")
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO api_requests (id, agent_id, run_id, message_id, kind, provider, credential_id, gateway_key_id, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, ttft_ms, duration_ms, cost_usd, error_message, raw_dump_json, stop_reason, turn_index, continuation_index, created_at) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)`, request.ID, request.AgentID, request.RunID, request.MessageID, request.Kind, request.Provider, request.CredentialID, request.GatewayKeyID, request.Model, request.InputTokens, request.OutputTokens, request.CachedInputTokens, request.ReasoningTokens, request.TTFTMS, request.DurationMS, request.CostUSD, request.ErrorMessage, string(request.RawDumpJSON), request.StopReason, request.TurnIndex, request.ContinuationIndex, request.CreatedAt)
	if err != nil {
		return APIRequest{}, err
	}
	return request, nil
}

func (s *Store) ListMCPServers(ctx context.Context) ([]MCPServer, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, transport, command, COALESCE(args_json,''), COALESCE(cwd,''), COALESCE(env_json,''), enabled, created_at, updated_at FROM mcp_servers ORDER BY enabled DESC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := make([]MCPServer, 0)
	for rows.Next() {
		server, err := scanMCPServer(rows.Scan)
		if err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}
	return servers, rows.Err()
}

func (s *Store) GetMCPServer(ctx context.Context, id string) (MCPServer, error) {
	return scanMCPServer(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, name, transport, command, COALESCE(args_json,''), COALESCE(cwd,''), COALESCE(env_json,''), enabled, created_at, updated_at FROM mcp_servers WHERE id = ?`, id).Scan(dest...)
	})
}

func (s *Store) CreateMCPServer(ctx context.Context, server MCPServer) (MCPServer, error) {
	if server.ID == "" {
		server.ID = NewID()
	}
	if server.Transport == "" {
		server.Transport = "stdio"
	}
	if server.Env == nil {
		server.Env = map[string]string{}
	}
	now := Now()
	server.CreatedAt = now
	server.UpdatedAt = now
	argsJSON, _ := json.Marshal(server.Args)
	envJSON, _ := json.Marshal(server.Env)
	_, err := s.db.ExecContext(ctx, `INSERT INTO mcp_servers (id, name, transport, command, args_json, cwd, env_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)`, server.ID, server.Name, server.Transport, server.Command, string(argsJSON), server.CWD, string(envJSON), boolInt(server.Enabled), server.CreatedAt, server.UpdatedAt)
	if err != nil {
		return MCPServer{}, err
	}
	return server, nil
}

func (s *Store) UpdateMCPServer(ctx context.Context, server MCPServer) (MCPServer, error) {
	if server.Env == nil {
		server.Env = map[string]string{}
	}
	now := Now()
	argsJSON, _ := json.Marshal(server.Args)
	envJSON, _ := json.Marshal(server.Env)
	result, err := s.db.ExecContext(ctx, `UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args_json = NULLIF(?, ''), cwd = NULLIF(?, ''), env_json = NULLIF(?, ''), enabled = ?, updated_at = ? WHERE id = ?`, server.Name, server.Transport, server.Command, string(argsJSON), server.CWD, string(envJSON), boolInt(server.Enabled), now, server.ID)
	if err != nil {
		return MCPServer{}, err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return MCPServer{}, sql.ErrNoRows
	}
	return s.GetMCPServer(ctx, server.ID)
}

func (s *Store) DeleteMCPServer(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM mcp_servers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListSkills(ctx context.Context) ([]Skill, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, command, description, prompt, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(deleted_at,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE deleted_at IS NULL AND scope = 'global' ORDER BY enabled DESC, command COLLATE NOCASE ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Skill, 0)
	for rows.Next() {
		skill, err := scanSkill(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, skill)
	}
	return items, rows.Err()
}

func (s *Store) ListSkillSummaries(ctx context.Context) ([]SkillSummary, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, command, description, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE deleted_at IS NULL AND scope = 'global' ORDER BY enabled DESC, command COLLATE NOCASE ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]SkillSummary, 0)
	for rows.Next() {
		var item SkillSummary
		var enabled int
		var findings string
		if err := rows.Scan(&item.ID, &item.Name, &item.Command, &item.Description, &item.Source, &item.Scope, &item.ProjectID, &item.WorklineID, &item.RevisionNo, &item.ContentHash, &enabled, &item.ScanVerdict, &findings, &item.ScannerVersion, &item.RiskAcknowledgedAt, &item.RiskAcknowledgedBy, &item.RiskAcknowledgedHash, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		var codes []json.RawMessage
		if json.Unmarshal([]byte(findings), &codes) != nil {
			return nil, errors.New("stored skill scan findings are not valid JSON")
		}
		item.FindingCount = len(codes)
		item.Enabled = enabled != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetSkill(ctx context.Context, id string) (Skill, error) {
	return scanSkill(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, name, command, description, prompt, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(deleted_at,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE id = ? AND deleted_at IS NULL`, id).Scan(dest...)
	})
}

// GetSkillByCommand returns the complete server skill for a slash command.
// Command matching follows the database's case-insensitive uniqueness rule.
func (s *Store) GetSkillByCommand(ctx context.Context, command string) (Skill, error) {
	return scanSkill(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, name, command, description, prompt, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(deleted_at,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE command = ? COLLATE NOCASE AND deleted_at IS NULL AND scope = 'global'`, command).Scan(dest...)
	})
}

func (s *Store) CreateSkill(ctx context.Context, skill Skill) (Skill, error) {
	return s.CreateSkillAs(ctx, skill, "system")
}

func (s *Store) CreateSkillAs(ctx context.Context, skill Skill, actor string) (Skill, error) {
	canonical, err := canonicalSkillRecord(skill)
	if err != nil {
		return Skill{}, err
	}
	if canonical.ID == "" {
		canonical.ID = NewID()
	}
	now := Now()
	canonical.CreatedAt, canonical.UpdatedAt = now, now
	canonical.RevisionNo = 1
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Skill{}, err
	}
	defer tx.Rollback()
	if err := validateSkillScopeTx(ctx, tx, canonical); err != nil {
		return Skill{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO skills (id, name, command, description, prompt, source, scope, project_id, workline_id, deleted_at, revision_no, content_hash, enabled, scan_verdict, scan_findings_json, scanner_version, risk_acknowledged_at, risk_acknowledged_by, risk_acknowledged_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULL, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?)`, canonical.ID, canonical.Name, canonical.Command, canonical.Description, canonical.Prompt, canonical.Source, canonical.Scope, canonical.ProjectID, canonical.WorklineID, canonical.RevisionNo, canonical.ContentHash, boolInt(canonical.Enabled), canonical.ScanVerdict, string(canonical.ScanFindings), canonical.ScannerVersion, canonical.RiskAcknowledgedAt, canonical.RiskAcknowledgedBy, canonical.RiskAcknowledgedHash, canonical.CreatedAt, canonical.UpdatedAt); err != nil {
		if isUniqueConstraint(err) {
			return Skill{}, fmt.Errorf("%w: skill command already exists", ErrConflict)
		}
		return Skill{}, err
	}
	if _, err := insertSkillRevision(ctx, tx, canonical, "create", actor, 0); err != nil {
		return Skill{}, err
	}
	if err := insertSkillAuditEvents(ctx, tx, canonical, nil, actor); err != nil {
		return Skill{}, err
	}
	if err := tx.Commit(); err != nil {
		return Skill{}, err
	}
	return canonical, nil
}

func (s *Store) UpdateSkill(ctx context.Context, skill Skill) (Skill, error) {
	return s.UpdateSkillAs(ctx, skill, "system")
}

func (s *Store) UpdateSkillAs(ctx context.Context, skill Skill, actor string) (Skill, error) {
	if strings.TrimSpace(skill.UpdatedAt) == "" {
		return Skill{}, errors.New("expected skill updated_at is required")
	}
	canonical, err := canonicalSkillRecord(skill)
	if err != nil {
		return Skill{}, err
	}
	expectedUpdatedAt := strings.TrimSpace(skill.UpdatedAt)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Skill{}, err
	}
	defer tx.Rollback()
	previous, err := scanSkill(func(dest ...any) error {
		return tx.QueryRowContext(ctx, `SELECT id, name, command, description, prompt, source, scope, COALESCE(project_id,''), COALESCE(workline_id,''), COALESCE(deleted_at,''), COALESCE(revision_no,1), content_hash, enabled, scan_verdict, scan_findings_json, COALESCE(scanner_version, 0), COALESCE(risk_acknowledged_at,''), COALESCE(risk_acknowledged_by,''), COALESCE(risk_acknowledged_hash,''), created_at, updated_at FROM skills WHERE id = ?`, canonical.ID).Scan(dest...)
	})
	if err != nil {
		return Skill{}, err
	}
	if previous.DeletedAt != "" {
		return Skill{}, sql.ErrNoRows
	}
	if strings.TrimSpace(skill.Scope) == "" {
		canonical.Scope, canonical.ProjectID, canonical.WorklineID = previous.Scope, previous.ProjectID, previous.WorklineID
	}
	canonical.CreatedAt, canonical.UpdatedAt = previous.CreatedAt, nextSkillUpdatedAt(previous.UpdatedAt)
	canonical.RevisionNo = previous.RevisionNo + 1
	if err := validateSkillScopeTx(ctx, tx, canonical); err != nil {
		return Skill{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE skills SET name = ?, command = ?, description = ?, prompt = ?, source = ?, scope = ?, project_id = NULLIF(?, ''), workline_id = NULLIF(?, ''), revision_no = ?, content_hash = ?, enabled = ?, scan_verdict = ?, scan_findings_json = ?, scanner_version = ?, risk_acknowledged_at = NULLIF(?, ''), risk_acknowledged_by = NULLIF(?, ''), risk_acknowledged_hash = NULLIF(?, ''), updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`, canonical.Name, canonical.Command, canonical.Description, canonical.Prompt, canonical.Source, canonical.Scope, canonical.ProjectID, canonical.WorklineID, canonical.RevisionNo, canonical.ContentHash, boolInt(canonical.Enabled), canonical.ScanVerdict, string(canonical.ScanFindings), canonical.ScannerVersion, canonical.RiskAcknowledgedAt, canonical.RiskAcknowledgedBy, canonical.RiskAcknowledgedHash, canonical.UpdatedAt, canonical.ID, expectedUpdatedAt)
	if err != nil {
		if isUniqueConstraint(err) {
			return Skill{}, fmt.Errorf("%w: skill command already exists", ErrConflict)
		}
		return Skill{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Skill{}, err
	}
	if affected != 1 {
		return Skill{}, skillUpdateConflict(ctx, tx, canonical.ID)
	}
	if _, err := insertSkillRevision(ctx, tx, canonical, "update", actor, 0); err != nil {
		return Skill{}, err
	}
	if err := insertSkillAuditEvents(ctx, tx, canonical, &previous, actor); err != nil {
		return Skill{}, err
	}
	if err := tx.Commit(); err != nil {
		return Skill{}, err
	}
	return canonical, nil
}

func (s *Store) DeleteSkill(ctx context.Context, id string) error {
	return s.DeleteSkillAs(ctx, id, "system")
}

func (s *Store) DeleteSkillAs(ctx context.Context, id, actor string) error {
	skill, err := s.GetSkill(ctx, id)
	if err != nil {
		return err
	}
	_, err = s.DeleteSkillCAS(ctx, id, skill.UpdatedAt, actor)
	return err
}

func (s *Store) ListSkillAuditEvents(ctx context.Context, skillID string, limit int) ([]SkillAuditEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, action, actor, skill_id, content_hash, scan_verdict, finding_codes_json, COALESCE(risk_acknowledged_at,''), created_at FROM skill_audit_events WHERE skill_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, skillID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]SkillAuditEvent, 0)
	for rows.Next() {
		var event SkillAuditEvent
		var codes string
		if err := rows.Scan(&event.ID, &event.Action, &event.Actor, &event.SkillID, &event.ContentHash, &event.ScanVerdict, &codes, &event.RiskAcknowledgedAt, &event.CreatedAt); err != nil {
			return nil, err
		}
		if !json.Valid([]byte(codes)) {
			return nil, errors.New("stored skill audit finding codes are not valid JSON")
		}
		event.FindingCodes = json.RawMessage(codes)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) CreateMemory(ctx context.Context, memory Memory) (Memory, error) {
	canonical, keywordsJSON, err := canonicalMemory(memory, false)
	if err != nil {
		return Memory{}, err
	}
	if canonical.ID == "" {
		canonical.ID = NewID()
	}
	if err := validateMemoryID(canonical.ID); err != nil {
		return Memory{}, err
	}
	now := Now()
	canonical.CreatedAt = now
	canonical.UpdatedAt = now
	_, err = s.db.ExecContext(ctx, `INSERT INTO memories (id, content, keywords_json, pinned, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?)`, canonical.ID, canonical.Content, keywordsJSON, boolInt(canonical.Pinned), canonical.ArchivedAt, canonical.CreatedAt, canonical.UpdatedAt)
	if err != nil {
		if isUniqueConstraint(err) {
			return Memory{}, fmt.Errorf("%w: memory id already exists", ErrConflict)
		}
		return Memory{}, err
	}
	return canonical, nil
}

func (s *Store) GetMemory(ctx context.Context, id string) (Memory, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Memory{}, sql.ErrNoRows
	}
	return scanMemory(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, content, keywords_json, pinned, COALESCE(archived_at,''), created_at, updated_at FROM memories WHERE id = ?`, id).Scan(dest...)
	})
}

// ListMemories accepts no options, a MemoryListOptions value, a query string,
// or a query string followed by includeArchived. Results are pinned first and
// then newest-updated first.
func (s *Store) ListMemories(ctx context.Context, args ...any) ([]Memory, error) {
	options, err := parseMemoryListOptions(args)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, content, keywords_json, pinned, COALESCE(archived_at,''), created_at, updated_at FROM memories WHERE ? = 1 OR archived_at IS NULL ORDER BY pinned DESC, updated_at DESC, id ASC`, boolInt(options.IncludeArchived))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	query := strings.ToLower(strings.TrimSpace(options.Query))
	memories := make([]Memory, 0)
	for rows.Next() {
		memory, err := scanMemory(rows.Scan)
		if err != nil {
			return nil, err
		}
		if query == "" || memoryMatchesQuery(memory, query) {
			memories = append(memories, memory)
		}
	}
	return memories, rows.Err()
}

func (s *Store) UpdateMemory(ctx context.Context, memory Memory) (Memory, error) {
	canonical, keywordsJSON, err := canonicalMemory(memory, true)
	if err != nil {
		return Memory{}, err
	}
	existing, err := s.GetMemory(ctx, canonical.ID)
	if err != nil {
		return Memory{}, err
	}
	canonical.CreatedAt = existing.CreatedAt
	canonical.UpdatedAt = nextMemoryUpdatedAt(existing.UpdatedAt)
	result, err := s.db.ExecContext(ctx, `UPDATE memories SET content = ?, keywords_json = ?, pinned = ?, archived_at = NULLIF(?, ''), updated_at = ? WHERE id = ?`, canonical.Content, keywordsJSON, boolInt(canonical.Pinned), canonical.ArchivedAt, canonical.UpdatedAt, canonical.ID)
	if err != nil {
		return Memory{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return Memory{}, err
	} else if affected != 1 {
		return Memory{}, sql.ErrNoRows
	}
	return canonical, nil
}

func (s *Store) DeleteMemory(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return sql.ErrNoRows
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM memories WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) SetMemoryPinned(ctx context.Context, id string, pinned bool) (Memory, error) {
	memory, err := s.GetMemory(ctx, id)
	if err != nil {
		return Memory{}, err
	}
	memory.Pinned = pinned
	return s.UpdateMemory(ctx, memory)
}

func (s *Store) PinMemory(ctx context.Context, id string, pinned ...bool) (Memory, error) {
	value := true
	if len(pinned) > 1 {
		return Memory{}, errors.New("pin memory accepts at most one pinned value")
	}
	if len(pinned) == 1 {
		value = pinned[0]
	}
	return s.SetMemoryPinned(ctx, id, value)
}

func (s *Store) UnpinMemory(ctx context.Context, id string) (Memory, error) {
	return s.SetMemoryPinned(ctx, id, false)
}

func (s *Store) SetMemoryArchived(ctx context.Context, id string, archived bool) (Memory, error) {
	memory, err := s.GetMemory(ctx, id)
	if err != nil {
		return Memory{}, err
	}
	if archived {
		memory.ArchivedAt = Now()
	} else {
		memory.ArchivedAt = ""
	}
	return s.UpdateMemory(ctx, memory)
}

func (s *Store) ArchiveMemory(ctx context.Context, id string) (Memory, error) {
	return s.SetMemoryArchived(ctx, id, true)
}

func (s *Store) UnarchiveMemory(ctx context.Context, id string) (Memory, error) {
	return s.SetMemoryArchived(ctx, id, false)
}

func (s *Store) ListMatchingUninjectedMemories(ctx context.Context, agentID, text string, limit int) ([]Memory, error) {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, errors.New("memory injection agent id is required")
	}
	if limit <= 0 {
		return []Memory{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.id, m.content, m.keywords_json, m.pinned, COALESCE(m.archived_at,''), m.created_at, m.updated_at FROM memories m WHERE m.archived_at IS NULL AND m.keywords_json <> '[]' AND NOT EXISTS (SELECT 1 FROM memory_injections i WHERE i.memory_id = m.id AND i.agent_id = ?) ORDER BY m.pinned DESC, m.updated_at DESC, m.id ASC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lowerText := strings.ToLower(text)
	matches := make([]Memory, 0, limit)
	for rows.Next() {
		memory, err := scanMemory(rows.Scan)
		if err != nil {
			return nil, err
		}
		if len(memory.Keywords) == 0 || !memoryKeywordsMatch(memory.Keywords, lowerText) {
			continue
		}
		matches = append(matches, memory)
		if len(matches) == limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return matches, nil
}

func (s *Store) MarkMemoriesInjected(ctx context.Context, agentID string, memoryIDs []string) error {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return errors.New("memory injection agent id is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM agents WHERE id = ?`, agentID).Scan(&exists); err != nil {
		return err
	}
	ids := make([]string, 0, len(memoryIDs))
	seen := make(map[string]struct{}, len(memoryIDs))
	for _, rawID := range memoryIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return errors.New("memory injection memory id is required")
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		if err := tx.QueryRowContext(ctx, `SELECT 1 FROM memories WHERE id = ?`, id).Scan(&exists); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	injectedAt := Now()
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_injections (memory_id, agent_id, injected_at) VALUES (?, ?, ?) ON CONFLICT(memory_id, agent_id) DO NOTHING`, id, agentID, injectedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func parseMemoryListOptions(args []any) (MemoryListOptions, error) {
	var options MemoryListOptions
	switch len(args) {
	case 0:
		return options, nil
	case 1:
		switch value := args[0].(type) {
		case MemoryListOptions:
			return value, nil
		case *MemoryListOptions:
			if value == nil {
				return options, nil
			}
			return *value, nil
		case string:
			options.Query = value
			return options, nil
		case bool:
			options.IncludeArchived = value
			return options, nil
		default:
			return options, errors.New("invalid memory list options")
		}
	case 2:
		query, queryOK := args[0].(string)
		includeArchived, archivedOK := args[1].(bool)
		if !queryOK || !archivedOK {
			return options, errors.New("invalid memory list options")
		}
		options.Query = query
		options.IncludeArchived = includeArchived
		return options, nil
	default:
		return options, errors.New("invalid memory list options")
	}
}

func canonicalMemory(memory Memory, requireID bool) (Memory, string, error) {
	memory.ID = strings.TrimSpace(memory.ID)
	memory.ArchivedAt = strings.TrimSpace(memory.ArchivedAt)
	if requireID || memory.ID != "" {
		if err := validateMemoryID(memory.ID); err != nil {
			return Memory{}, "", err
		}
	}
	if strings.TrimSpace(memory.Content) == "" {
		return Memory{}, "", errors.New("memory content is required")
	}
	if len(memory.Content) > MemoryContentMaxBytes {
		return Memory{}, "", fmt.Errorf("memory content exceeds %d bytes", MemoryContentMaxBytes)
	}
	if !utf8.ValidString(memory.Content) || strings.ContainsRune(memory.Content, 0) {
		return Memory{}, "", errors.New("invalid memory content")
	}
	keywords, err := normalizeMemoryKeywords(memory.Keywords)
	if err != nil {
		return Memory{}, "", err
	}
	encoded, err := json.Marshal(keywords)
	if err != nil {
		return Memory{}, "", fmt.Errorf("encode memory keywords: %w", err)
	}
	memory.Keywords = keywords
	if memory.ArchivedAt != "" {
		if _, err := time.Parse(time.RFC3339Nano, memory.ArchivedAt); err != nil {
			return Memory{}, "", errors.New("invalid memory archived_at")
		}
	}
	return memory, string(encoded), nil
}

func validateMemoryID(id string) error {
	if id == "" {
		return errors.New("memory id is required")
	}
	if len(id) > 128 || !utf8.ValidString(id) || strings.ContainsRune(id, 0) {
		return errors.New("invalid memory id")
	}
	return nil
}

func normalizeMemoryKeywords(keywords []string) ([]string, error) {
	normalized := make([]string, 0, len(keywords))
	seen := make(map[string]struct{}, len(keywords))
	for _, keyword := range keywords {
		keyword = strings.ToLower(strings.TrimSpace(keyword))
		if keyword == "" {
			return nil, errors.New("memory keyword must not be empty")
		}
		if !utf8.ValidString(keyword) || strings.ContainsRune(keyword, 0) {
			return nil, errors.New("invalid memory keyword")
		}
		if utf8.RuneCountInString(keyword) > MemoryKeywordMaxRunes {
			return nil, fmt.Errorf("memory keyword exceeds %d runes", MemoryKeywordMaxRunes)
		}
		if _, duplicate := seen[keyword]; duplicate {
			continue
		}
		seen[keyword] = struct{}{}
		normalized = append(normalized, keyword)
		if len(normalized) > MemoryMaxKeywords {
			return nil, fmt.Errorf("memory keywords exceed maximum of %d", MemoryMaxKeywords)
		}
	}
	return normalized, nil
}

func memoryMatchesQuery(memory Memory, lowerQuery string) bool {
	if strings.Contains(strings.ToLower(memory.Content), lowerQuery) {
		return true
	}
	return memoryKeywordsMatch(memory.Keywords, lowerQuery)
}

func memoryKeywordsMatch(keywords []string, lowerText string) bool {
	for _, keyword := range keywords {
		if strings.Contains(lowerText, keyword) {
			return true
		}
	}
	return false
}

func nextMemoryUpdatedAt(previous string) string {
	now := time.Now().UTC()
	if prior, err := time.Parse(time.RFC3339Nano, previous); err == nil && !now.After(prior) {
		now = prior.Add(time.Nanosecond)
	}
	return now.Format(time.RFC3339Nano)
}

type memoryScanner func(dest ...any) error

func scanMemory(scan memoryScanner) (Memory, error) {
	var memory Memory
	var keywordsJSON string
	var pinned int
	if err := scan(&memory.ID, &memory.Content, &keywordsJSON, &pinned, &memory.ArchivedAt, &memory.CreatedAt, &memory.UpdatedAt); err != nil {
		return Memory{}, err
	}
	var keywords []string
	if err := json.Unmarshal([]byte(keywordsJSON), &keywords); err != nil || keywords == nil {
		return Memory{}, fmt.Errorf("stored memory keywords for %s are invalid", memory.ID)
	}
	normalized, err := normalizeMemoryKeywords(keywords)
	if err != nil {
		return Memory{}, fmt.Errorf("stored memory keywords for %s are invalid: %w", memory.ID, err)
	}
	memory.Keywords = normalized
	memory.Pinned = pinned != 0
	return memory, nil
}

func (s *Store) ListIntegrationConnections(ctx context.Context) ([]IntegrationConnection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, kind, name, enabled, endpoint, settings_json, secret_refs_json, created_at, updated_at FROM integration_connections ORDER BY kind ASC, name ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	connections := make([]IntegrationConnection, 0)
	for rows.Next() {
		connection, err := scanIntegrationConnection(rows.Scan)
		if err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}
	return connections, rows.Err()
}

func (s *Store) GetIntegrationConnection(ctx context.Context, id string) (IntegrationConnection, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return IntegrationConnection{}, sql.ErrNoRows
	}
	return scanIntegrationConnection(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, kind, name, enabled, endpoint, settings_json, secret_refs_json, created_at, updated_at FROM integration_connections WHERE id = ?`, id).Scan(dest...)
	})
}

func (s *Store) CreateIntegrationConnection(ctx context.Context, connection IntegrationConnection) (IntegrationConnection, error) {
	canonical, settings, refs, err := canonicalIntegrationConnection(connection)
	if err != nil {
		return IntegrationConnection{}, err
	}
	if canonical.ID == "" {
		canonical.ID = NewID()
	}
	if err := validateIntegrationText("id", canonical.ID, 128, true, false); err != nil {
		return IntegrationConnection{}, err
	}
	now := Now()
	canonical.CreatedAt, canonical.UpdatedAt = now, now
	_, err = s.db.ExecContext(ctx, `INSERT INTO integration_connections (id, kind, name, enabled, endpoint, settings_json, secret_refs_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, canonical.ID, canonical.Kind, canonical.Name, boolInt(canonical.Enabled), canonical.Endpoint, settings, refs, canonical.CreatedAt, canonical.UpdatedAt)
	if err != nil {
		if isUniqueConstraint(err) {
			return IntegrationConnection{}, fmt.Errorf("%w: integration connection kind and name already exist", ErrConflict)
		}
		return IntegrationConnection{}, err
	}
	return canonical, nil
}

func (s *Store) UpdateIntegrationConnection(ctx context.Context, connection IntegrationConnection) (IntegrationConnection, error) {
	canonical, settings, refs, err := canonicalIntegrationConnection(connection)
	if err != nil {
		return IntegrationConnection{}, err
	}
	if err := validateIntegrationText("id", canonical.ID, 128, true, false); err != nil {
		return IntegrationConnection{}, err
	}
	canonical.UpdatedAt = Now()
	result, err := s.db.ExecContext(ctx, `UPDATE integration_connections SET kind = ?, name = ?, enabled = ?, endpoint = ?, settings_json = ?, secret_refs_json = ?, updated_at = ? WHERE id = ?`, canonical.Kind, canonical.Name, boolInt(canonical.Enabled), canonical.Endpoint, settings, refs, canonical.UpdatedAt, canonical.ID)
	if err != nil {
		if isUniqueConstraint(err) {
			return IntegrationConnection{}, fmt.Errorf("%w: integration connection kind and name already exist", ErrConflict)
		}
		return IntegrationConnection{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return IntegrationConnection{}, err
	}
	if affected == 0 {
		return IntegrationConnection{}, sql.ErrNoRows
	}
	return s.GetIntegrationConnection(ctx, canonical.ID)
}

func (s *Store) DeleteIntegrationConnection(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return sql.ErrNoRows
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM integration_connections WHERE id = ?`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func canonicalIntegrationConnection(connection IntegrationConnection) (IntegrationConnection, string, string, error) {
	connection.ID = strings.TrimSpace(connection.ID)
	connection.Kind = strings.TrimSpace(connection.Kind)
	connection.Name = strings.TrimSpace(connection.Name)
	connection.Endpoint = strings.TrimSpace(connection.Endpoint)
	if err := validateIntegrationText("kind", connection.Kind, 64, true, true); err != nil {
		return IntegrationConnection{}, "", "", err
	}
	if err := validateIntegrationText("name", connection.Name, 120, true, false); err != nil {
		return IntegrationConnection{}, "", "", err
	}
	if err := validateIntegrationText("endpoint", connection.Endpoint, 2048, false, false); err != nil {
		return IntegrationConnection{}, "", "", err
	}
	settings, err := normalizeIntegrationSettings(connection.SettingsJSON)
	if err != nil {
		return IntegrationConnection{}, "", "", err
	}
	secretRefs, encodedRefs, err := normalizeIntegrationSecretRefs(connection.SecretRefs)
	if err != nil {
		return IntegrationConnection{}, "", "", err
	}
	connection.SettingsJSON = settings
	connection.SecretRefs = secretRefs
	connection.SecretConfigured = integrationSecretConfigured(secretRefs)
	return connection, string(settings), string(encodedRefs), nil
}

func validateIntegrationText(name, value string, maxBytes int, required, token bool) error {
	if required && value == "" {
		return fmt.Errorf("integration connection %s is required", name)
	}
	if value == "" {
		return nil
	}
	if len(value) > maxBytes || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
		return fmt.Errorf("invalid integration connection %s", name)
	}
	if token {
		for i, char := range value {
			if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (i > 0 && char >= '0' && char <= '9') || (i > 0 && strings.ContainsRune("_.:-", char)) {
				continue
			}
			return fmt.Errorf("invalid integration connection %s", name)
		}
	}
	return nil
}

func normalizeIntegrationSettings(raw json.RawMessage) (json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		trimmed = `{}`
	}
	if len(trimmed) > IntegrationSettingsMaxBytes {
		return nil, fmt.Errorf("integration settings exceed %d bytes", IntegrationSettingsMaxBytes)
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("integration settings must be a valid JSON object")
	}
	var settings map[string]any
	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&settings); err != nil || settings == nil {
		return nil, errors.New("integration settings must be a valid JSON object")
	}
	if key, found := integrationSensitiveKey(settings); found {
		return nil, fmt.Errorf("integration settings contain forbidden sensitive key %q", key)
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return nil, fmt.Errorf("encode integration settings: %w", err)
	}
	if len(encoded) > IntegrationSettingsMaxBytes {
		return nil, fmt.Errorf("integration settings exceed %d bytes", IntegrationSettingsMaxBytes)
	}
	return encoded, nil
}

func integrationSensitiveKey(value any) (string, bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if forbiddenIntegrationSettingsKey(key) {
				return key, true
			}
			if nested, found := integrationSensitiveKey(child); found {
				return nested, true
			}
		}
	case []any:
		for _, child := range typed {
			if nested, found := integrationSensitiveKey(child); found {
				return nested, true
			}
		}
	}
	return "", false
}

func forbiddenIntegrationSettingsKey(key string) bool {
	var normalized strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(key)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			normalized.WriteRune(char)
		}
	}
	value := normalized.String()
	for _, marker := range []string{"password", "passwd", "secret", "token", "apikey", "credential", "privatekey", "accesskey", "authorization", "cookie"} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func normalizeIntegrationSecretRefs(input map[string]string) (map[string]string, json.RawMessage, error) {
	if input == nil {
		input = map[string]string{}
	}
	refs := make(map[string]string, len(input))
	for rawName, value := range input {
		name := strings.TrimSpace(rawName)
		if !validIntegrationSecretName(name) {
			return nil, nil, errors.New("invalid integration secret logical name")
		}
		if _, exists := refs[name]; exists {
			return nil, nil, errors.New("duplicate integration secret logical name")
		}
		ref, err := secrets.ParseRef(value)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid integration secret reference for %q: %w", name, err)
		}
		refs[name] = ref.String()
	}
	encoded, err := json.Marshal(refs)
	if err != nil {
		return nil, nil, fmt.Errorf("encode integration secret references: %w", err)
	}
	if len(encoded) > IntegrationSecretRefsMaxBytes {
		return nil, nil, fmt.Errorf("integration secret references exceed %d bytes", IntegrationSecretRefsMaxBytes)
	}
	return refs, encoded, nil
}

func validIntegrationSecretName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for i, char := range name {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (i > 0 && char >= '0' && char <= '9') || (i > 0 && strings.ContainsRune("_.-", char)) {
			continue
		}
		return false
	}
	return true
}

func integrationSecretConfigured(refs map[string]string) map[string]bool {
	configured := make(map[string]bool, len(refs))
	for name := range refs {
		configured[name] = true
	}
	return configured
}

type integrationConnectionScanner func(dest ...any) error

func scanIntegrationConnection(scan integrationConnectionScanner) (IntegrationConnection, error) {
	var connection IntegrationConnection
	var enabled int
	var settingsJSON, refsJSON string
	if err := scan(&connection.ID, &connection.Kind, &connection.Name, &enabled, &connection.Endpoint, &settingsJSON, &refsJSON, &connection.CreatedAt, &connection.UpdatedAt); err != nil {
		return IntegrationConnection{}, err
	}
	settings, err := normalizeIntegrationSettings(json.RawMessage(settingsJSON))
	if err != nil {
		return IntegrationConnection{}, fmt.Errorf("stored integration settings for %s are invalid: %w", connection.ID, err)
	}
	var refs map[string]string
	if err := json.Unmarshal([]byte(refsJSON), &refs); err != nil || refs == nil {
		return IntegrationConnection{}, fmt.Errorf("stored integration secret references for %s are invalid", connection.ID)
	}
	refs, _, err = normalizeIntegrationSecretRefs(refs)
	if err != nil {
		return IntegrationConnection{}, fmt.Errorf("stored integration secret references for %s are invalid: %w", connection.ID, err)
	}
	connection.Enabled = enabled != 0
	connection.SettingsJSON = settings
	connection.SecretRefs = refs
	connection.SecretConfigured = integrationSecretConfigured(refs)
	return connection, nil
}

func (s *Store) AddAutomationAuditEvent(ctx context.Context, event AutomationAuditEvent) (AutomationAuditEvent, error) {
	canonical, err := canonicalAutomationAuditEvent(event)
	if err != nil {
		return AutomationAuditEvent{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO automation_audit_events (id, category, action, actor, agent_id, run_id, subject_type, subject_id, outcome, risk, details_json, created_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?)`, canonical.ID, canonical.Category, canonical.Action, canonical.Actor, canonical.AgentID, canonical.RunID, canonical.SubjectType, canonical.SubjectID, canonical.Outcome, canonical.Risk, string(canonical.DetailsJSON), canonical.CreatedAt)
	if err != nil {
		return AutomationAuditEvent{}, fmt.Errorf("insert automation audit event: %w", err)
	}
	return canonical, nil
}

// RecordAutomationAuditEvent is an explicit audit-oriented alias for callers
// that do not otherwise use Store's Add naming convention.
func (s *Store) RecordAutomationAuditEvent(ctx context.Context, event AutomationAuditEvent) (AutomationAuditEvent, error) {
	return s.AddAutomationAuditEvent(ctx, event)
}

func (s *Store) CreateAutomationAuditEvent(ctx context.Context, event AutomationAuditEvent) (AutomationAuditEvent, error) {
	return s.AddAutomationAuditEvent(ctx, event)
}

// ListAutomationAuditEvents returns newest events first. A zero limit uses 50;
// callers may request at most AutomationAuditMaxListLimit rows and paginate with
// a non-negative offset.
func (s *Store) ListAutomationAuditEvents(ctx context.Context, limit, offset int) ([]AutomationAuditEvent, error) {
	if limit == 0 {
		limit = 50
	}
	if limit < 0 || limit > AutomationAuditMaxListLimit {
		return nil, fmt.Errorf("automation audit limit must be between 1 and %d", AutomationAuditMaxListLimit)
	}
	if offset < 0 {
		return nil, errors.New("automation audit offset must not be negative")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, category, action, actor, COALESCE(agent_id,''), COALESCE(run_id,''), COALESCE(subject_type,''), COALESCE(subject_id,''), outcome, risk, details_json, created_at FROM automation_audit_events ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]AutomationAuditEvent, 0)
	for rows.Next() {
		var event AutomationAuditEvent
		var details string
		if err := rows.Scan(&event.ID, &event.Category, &event.Action, &event.Actor, &event.AgentID, &event.RunID, &event.SubjectType, &event.SubjectID, &event.Outcome, &event.Risk, &details, &event.CreatedAt); err != nil {
			return nil, err
		}
		event.DetailsJSON, err = normalizeAutomationAuditDetails(json.RawMessage(details))
		if err != nil {
			return nil, fmt.Errorf("stored automation audit details for %s are invalid: %w", event.ID, err)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func canonicalAutomationAuditEvent(event AutomationAuditEvent) (AutomationAuditEvent, error) {
	event.ID = strings.TrimSpace(event.ID)
	event.Category = strings.TrimSpace(event.Category)
	event.Action = strings.TrimSpace(event.Action)
	event.Actor = strings.TrimSpace(event.Actor)
	event.AgentID = strings.TrimSpace(event.AgentID)
	event.RunID = strings.TrimSpace(event.RunID)
	event.SubjectType = strings.TrimSpace(event.SubjectType)
	event.SubjectID = strings.TrimSpace(event.SubjectID)
	event.Outcome = strings.TrimSpace(event.Outcome)
	event.Risk = strings.TrimSpace(event.Risk)
	event.CreatedAt = strings.TrimSpace(event.CreatedAt)

	if event.ID == "" {
		event.ID = NewID()
	}
	if event.CreatedAt == "" {
		event.CreatedAt = Now()
	}
	for _, field := range []struct {
		name     string
		value    string
		maxBytes int
		required bool
		token    bool
	}{
		{"id", event.ID, 128, true, false},
		{"category", event.Category, 64, true, true},
		{"action", event.Action, 96, true, true},
		{"actor", event.Actor, 200, true, false},
		{"agent_id", event.AgentID, 128, false, false},
		{"run_id", event.RunID, 128, false, false},
		{"subject_type", event.SubjectType, 64, false, true},
		{"subject_id", event.SubjectID, 256, false, false},
	} {
		if err := validateAutomationAuditText(field.name, field.value, field.maxBytes, field.required, field.token); err != nil {
			return AutomationAuditEvent{}, err
		}
	}
	if (event.SubjectType == "") != (event.SubjectID == "") {
		return AutomationAuditEvent{}, errors.New("automation audit subject_type and subject_id must be provided together")
	}
	if !validAutomationAuditOutcome(event.Outcome) {
		return AutomationAuditEvent{}, errors.New("invalid automation audit outcome")
	}
	if !validAutomationAuditRisk(event.Risk) {
		return AutomationAuditEvent{}, errors.New("invalid automation audit risk")
	}
	if _, err := time.Parse(time.RFC3339Nano, event.CreatedAt); err != nil {
		return AutomationAuditEvent{}, errors.New("invalid automation audit created_at")
	}
	var err error
	event.DetailsJSON, err = normalizeAutomationAuditDetails(event.DetailsJSON)
	if err != nil {
		return AutomationAuditEvent{}, err
	}
	return event, nil
}

func validateAutomationAuditText(name, value string, maxBytes int, required, token bool) error {
	if required && value == "" {
		return fmt.Errorf("automation audit %s is required", name)
	}
	if value == "" {
		return nil
	}
	if len(value) > maxBytes || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
		return fmt.Errorf("invalid automation audit %s", name)
	}
	if token && !validAutomationAuditToken(value) {
		return fmt.Errorf("invalid automation audit %s", name)
	}
	return nil
}

func validAutomationAuditToken(value string) bool {
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			continue
		}
		switch char {
		case '.', '_', ':', '-', '/':
			continue
		default:
			return false
		}
	}
	return value != ""
}

func validAutomationAuditOutcome(value string) bool {
	switch value {
	case "success", "failure", "denied", "error", "unknown":
		return true
	default:
		return false
	}
}

func validAutomationAuditRisk(value string) bool {
	switch value {
	case "none", "low", "medium", "high", "critical":
		return true
	default:
		return false
	}
}

func normalizeAutomationAuditDetails(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) == 0 {
		trimmed = `{}`
	}
	if len(trimmed) > AutomationAuditDetailsMaxBytes {
		return nil, fmt.Errorf("automation audit details exceed %d bytes", AutomationAuditDetailsMaxBytes)
	}
	var details map[string]any
	if err := json.Unmarshal([]byte(trimmed), &details); err != nil {
		return nil, errors.New("automation audit details must be a valid JSON object")
	}
	if details == nil {
		return nil, errors.New("automation audit details must be a valid JSON object")
	}
	if key, found := automationAuditSensitiveKey(details); found {
		return nil, fmt.Errorf("automation audit details contain forbidden sensitive key %q", key)
	}
	encoded, err := json.Marshal(details)
	if err != nil {
		return nil, fmt.Errorf("encode automation audit details: %w", err)
	}
	if len(encoded) > AutomationAuditDetailsMaxBytes {
		return nil, fmt.Errorf("automation audit details exceed %d bytes", AutomationAuditDetailsMaxBytes)
	}
	return json.RawMessage(encoded), nil
}

func automationAuditSensitiveKey(value any) (string, bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if forbiddenAutomationAuditKey(key) {
				return key, true
			}
			if nested, found := automationAuditSensitiveKey(child); found {
				return nested, true
			}
		}
	case []any:
		for _, child := range typed {
			if nested, found := automationAuditSensitiveKey(child); found {
				return nested, true
			}
		}
	}
	return "", false
}

func forbiddenAutomationAuditKey(key string) bool {
	var normalized strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(key)) {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' {
			normalized.WriteRune(char)
		}
	}
	value := normalized.String()
	if value == "input" || strings.Contains(value, "rawinput") || strings.Contains(value, "inputjson") || strings.Contains(value, "toolinput") || value == "toolargs" || value == "toolarguments" {
		return true
	}
	for _, marker := range []string{"password", "passwd", "secret", "apikey", "privatekey", "accesskey", "credential", "authorization", "cookie"} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	if value == "token" || strings.HasSuffix(value, "token") {
		return true
	}
	return false
}

func nextSkillUpdatedAt(previous string) string {
	now := time.Now().UTC()
	if prior, err := time.Parse(time.RFC3339Nano, previous); err == nil && !now.After(prior) {
		now = prior.Add(time.Nanosecond)
	}
	return now.Format(time.RFC3339Nano)
}

func skillUpdateConflict(ctx context.Context, tx *sql.Tx, id string) error {
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM skills WHERE id = ?`, id).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
		return err
	}
	return fmt.Errorf("%w: skill was updated by another client", ErrConflict)
}

func insertSkillAuditEvents(ctx context.Context, tx *sql.Tx, current Skill, previous *Skill, actor string) error {
	if previous == nil {
		if err := insertSkillAuditEvent(ctx, tx, skillAuditEvent("create", current, actor)); err != nil {
			return err
		}
		if current.Enabled {
			return insertSkillAuditEvent(ctx, tx, skillAuditEvent("enable", current, actor))
		}
		return nil
	}
	contentChanged := current.Name != previous.Name || current.Command != previous.Command || current.Description != previous.Description || current.Prompt != previous.Prompt || current.ContentHash != previous.ContentHash
	metadataChanged := current.ScanVerdict != previous.ScanVerdict || string(current.ScanFindings) != string(previous.ScanFindings) || current.RiskAcknowledgedAt != previous.RiskAcknowledgedAt || current.RiskAcknowledgedBy != previous.RiskAcknowledgedBy || current.RiskAcknowledgedHash != previous.RiskAcknowledgedHash
	if contentChanged || metadataChanged {
		if err := insertSkillAuditEvent(ctx, tx, skillAuditEvent("update", current, actor)); err != nil {
			return err
		}
	}
	if current.Enabled != previous.Enabled {
		action := "disable"
		if current.Enabled {
			action = "enable"
		}
		if err := insertSkillAuditEvent(ctx, tx, skillAuditEvent(action, current, actor)); err != nil {
			return err
		}
	}
	return nil
}

func skillAuditEvent(action string, skill Skill, actor string) SkillAuditEvent {
	return SkillAuditEvent{Action: action, Actor: normalizeSkillAuditActor(actor), SkillID: skill.ID, ContentHash: skill.ContentHash, ScanVerdict: skill.ScanVerdict, FindingCodes: skillFindingCodes(skill.ScanFindings), RiskAcknowledgedAt: skill.RiskAcknowledgedAt, CreatedAt: Now()}
}

func insertSkillAuditEvent(ctx context.Context, tx *sql.Tx, event SkillAuditEvent) error {
	if event.ID == "" {
		event.ID = NewID()
	}
	if event.CreatedAt == "" {
		event.CreatedAt = Now()
	}
	if !json.Valid(event.FindingCodes) {
		return errors.New("invalid skill audit finding codes")
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO skill_audit_events (id, action, actor, skill_id, content_hash, scan_verdict, finding_codes_json, risk_acknowledged_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)`, event.ID, event.Action, event.Actor, event.SkillID, event.ContentHash, event.ScanVerdict, string(event.FindingCodes), event.RiskAcknowledgedAt, event.CreatedAt)
	return err
}

func normalizeSkillAuditActor(actor string) string {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return "system"
	}
	return actor
}

func skillFindingCodes(findings json.RawMessage) json.RawMessage {
	var parsed []skills.Finding
	if json.Unmarshal(findings, &parsed) != nil {
		return json.RawMessage("[]")
	}
	codes := make([]string, 0, len(parsed))
	for _, finding := range parsed {
		if strings.TrimSpace(finding.Code) != "" {
			codes = append(codes, finding.Code)
		}
	}
	encoded, err := json.Marshal(codes)
	if err != nil {
		return json.RawMessage("[]")
	}
	return encoded
}

func (s *Store) SeedBackends(ctx context.Context, backends []Backend) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM agent_backends`).Scan(&count); err != nil {
		return err
	}
	if count > 0 || len(backends) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	hasActive := false
	for _, backend := range backends {
		if backend.Name == "" || backend.BaseURL == "" {
			continue
		}
		if backend.ID == "" {
			backend.ID = NewID()
		}
		if backend.Kind == "" {
			backend.Kind = "local"
		}
		now := Now()
		backend.CreatedAt = now
		backend.UpdatedAt = now
		active := backend.Active || !hasActive
		if active {
			hasActive = true
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO agent_backends (id, name, kind, base_url, api_key, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, backend.ID, backend.Name, backend.Kind, backend.BaseURL, nullEmpty(backend.APIKey), boolInt(active), backend.CreatedAt, backend.UpdatedAt); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) ListBackends(ctx context.Context) ([]Backend, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, kind, base_url, COALESCE(api_key,''), active, created_at, updated_at FROM agent_backends ORDER BY active DESC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var backends []Backend
	for rows.Next() {
		backend, err := scanBackend(rows.Scan)
		if err != nil {
			return nil, err
		}
		backends = append(backends, backend)
	}
	return backends, rows.Err()
}

func (s *Store) GetBackend(ctx context.Context, id string) (Backend, error) {
	return scanBackend(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT id, name, kind, base_url, COALESCE(api_key,''), active, created_at, updated_at FROM agent_backends WHERE id = ?`, id).Scan(dest...)
	})
}

func (s *Store) CreateBackend(ctx context.Context, backend Backend) (Backend, error) {
	if backend.ID == "" {
		backend.ID = NewID()
	}
	if backend.Kind == "" {
		backend.Kind = "local"
	}
	now := Now()
	backend.CreatedAt = now
	backend.UpdatedAt = now

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Backend{}, err
	}
	defer tx.Rollback()

	var activeCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM agent_backends WHERE active = 1`).Scan(&activeCount); err != nil {
		return Backend{}, err
	}
	backend.Active = backend.Active || activeCount == 0
	if backend.Active {
		if _, err := tx.ExecContext(ctx, `UPDATE agent_backends SET active = 0, updated_at = ? WHERE active = 1`, now); err != nil {
			return Backend{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_backends (id, name, kind, base_url, api_key, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, backend.ID, backend.Name, backend.Kind, backend.BaseURL, nullEmpty(backend.APIKey), boolInt(backend.Active), backend.CreatedAt, backend.UpdatedAt); err != nil {
		return Backend{}, err
	}
	if err := tx.Commit(); err != nil {
		return Backend{}, err
	}
	return backend, nil
}

func (s *Store) UpdateBackend(ctx context.Context, backend Backend) (Backend, error) {
	now := Now()
	if backend.Active {
		if _, err := s.db.ExecContext(ctx, `UPDATE agent_backends SET active = 0, updated_at = ? WHERE id != ? AND active = 1`, now, backend.ID); err != nil {
			return Backend{}, err
		}
	}
	result, err := s.db.ExecContext(ctx, `UPDATE agent_backends SET name = ?, kind = ?, base_url = ?, api_key = NULLIF(?, ''), active = ?, updated_at = ? WHERE id = ?`, backend.Name, backend.Kind, backend.BaseURL, backend.APIKey, boolInt(backend.Active), now, backend.ID)
	if err != nil {
		return Backend{}, err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return Backend{}, sql.ErrNoRows
	}
	return s.GetBackend(ctx, backend.ID)
}

func (s *Store) ActivateBackend(ctx context.Context, id string) (Backend, error) {
	now := Now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Backend{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE agent_backends SET active = 0, updated_at = ? WHERE active = 1`, now); err != nil {
		return Backend{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE agent_backends SET active = 1, updated_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return Backend{}, err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return Backend{}, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return Backend{}, err
	}
	return s.GetBackend(ctx, id)
}

func (s *Store) DeleteBackend(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var wasActive int
	if err := tx.QueryRowContext(ctx, `SELECT active FROM agent_backends WHERE id = ?`, id).Scan(&wasActive); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM agent_backends WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return sql.ErrNoRows
	}
	if wasActive != 0 {
		_, err = tx.ExecContext(ctx, `UPDATE agent_backends SET active = 1, updated_at = ? WHERE id = (SELECT id FROM agent_backends ORDER BY created_at ASC LIMIT 1)`, Now())
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

type backendScanner func(dest ...any) error

type mcpServerScanner func(dest ...any) error

type skillScanner func(dest ...any) error

type notificationSettingsScanner func(dest ...any) error

type workflowPreferencesScanner func(dest ...any) error

type toolPermissionRuleScanner func(dest ...any) error

func scanNotificationSettings(scan notificationSettingsScanner) (NotificationSettings, error) {
	var settings NotificationSettings
	var enabled, notifyOnApproval, notifyOnDone, notifyOnError int
	if err := scan(&settings.ID, &enabled, &settings.WebhookURL, &notifyOnApproval, &notifyOnDone, &notifyOnError, &settings.CreatedAt, &settings.UpdatedAt); err != nil {
		return NotificationSettings{}, err
	}
	settings.Enabled = enabled != 0
	settings.NotifyOnApproval = notifyOnApproval != 0
	settings.NotifyOnDone = notifyOnDone != 0
	settings.NotifyOnError = notifyOnError != 0
	return settings, nil
}

func scanWorkflowPreferences(scan workflowPreferencesScanner) (WorkflowPreferences, error) {
	var prefs WorkflowPreferences
	var requireExec, requireWrites, allowReadOnly int
	if err := scan(&prefs.ID, &requireExec, &requireWrites, &allowReadOnly, &prefs.PolicyGeneration, &prefs.CreatedAt, &prefs.UpdatedAt); err != nil {
		return WorkflowPreferences{}, err
	}
	prefs.RequireConfirmationForExec = requireExec != 0
	prefs.RequireConfirmationForWrites = requireWrites != 0
	prefs.AllowReadOnlyByDefault = allowReadOnly != 0
	return prefs, nil
}

func scanToolPermissionRule(scan toolPermissionRuleScanner) (ToolPermissionRule, error) {
	var rule ToolPermissionRule
	var enabled int
	if err := scan(&rule.ID, &rule.Mode, &rule.ToolName, &rule.Risk, &rule.Decision, &rule.Priority, &enabled, &rule.Description, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
		return ToolPermissionRule{}, err
	}
	rule.Enabled = enabled != 0
	return rule, nil
}

func scanSkill(scan skillScanner) (Skill, error) {
	var skill Skill
	var enabled int
	var findings string
	if err := scan(&skill.ID, &skill.Name, &skill.Command, &skill.Description, &skill.Prompt, &skill.Source, &skill.Scope, &skill.ProjectID, &skill.WorklineID, &skill.DeletedAt, &skill.RevisionNo, &skill.ContentHash, &enabled, &skill.ScanVerdict, &findings, &skill.ScannerVersion, &skill.RiskAcknowledgedAt, &skill.RiskAcknowledgedBy, &skill.RiskAcknowledgedHash, &skill.CreatedAt, &skill.UpdatedAt); err != nil {
		return Skill{}, err
	}
	if !json.Valid([]byte(findings)) {
		return Skill{}, errors.New("stored skill scan findings are not valid JSON")
	}
	skill.ScanFindings = json.RawMessage(findings)
	skill.Enabled = enabled != 0
	return skill, nil
}

func scanMCPServer(scan mcpServerScanner) (MCPServer, error) {
	var server MCPServer
	var argsJSON, envJSON string
	var enabled int
	if err := scan(&server.ID, &server.Name, &server.Transport, &server.Command, &argsJSON, &server.CWD, &envJSON, &enabled, &server.CreatedAt, &server.UpdatedAt); err != nil {
		return MCPServer{}, err
	}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &server.Args); err != nil {
			return MCPServer{}, err
		}
	}
	if strings.TrimSpace(envJSON) != "" {
		if err := json.Unmarshal([]byte(envJSON), &server.Env); err != nil {
			return MCPServer{}, err
		}
	}
	if server.Env == nil {
		server.Env = map[string]string{}
	}
	server.Enabled = enabled != 0
	return server, nil
}

func scanBackend(scan backendScanner) (Backend, error) {
	var backend Backend
	var active int
	if err := scan(&backend.ID, &backend.Name, &backend.Kind, &backend.BaseURL, &backend.APIKey, &active, &backend.CreatedAt, &backend.UpdatedAt); err != nil {
		return Backend{}, err
	}
	backend.Active = active != 0
	return backend, nil
}

// canonicalSkillRecord makes the persistent store the trust boundary for skill
// metadata. Callers may supply only editable content and state; scanner fields are
// always regenerated from the normalized content before state validation.
func canonicalSkillRecord(skill Skill) (Skill, error) {
	parsed, err := skills.Normalize(skills.Skill{
		Name:        skill.Name,
		Command:     skill.Command,
		Description: skill.Description,
		Prompt:      skill.Prompt,
	})
	if err != nil {
		return Skill{}, err
	}
	result := skills.Scan(parsed)
	findings, err := json.Marshal(result.Findings)
	if err != nil {
		return Skill{}, fmt.Errorf("encode skill scan findings: %w", err)
	}
	skill.Name = parsed.Name
	skill.Command = parsed.Command
	skill.Description = parsed.Description
	skill.Prompt = parsed.Prompt
	skill.ContentHash = result.Hash
	skill.ScanVerdict = result.Verdict
	skill.Scope = strings.TrimSpace(skill.Scope)
	if skill.Scope == "" {
		skill.Scope = "global"
	}
	skill.ProjectID = strings.TrimSpace(skill.ProjectID)
	skill.WorklineID = strings.TrimSpace(skill.WorklineID)
	skill.ScanFindings = findings
	skill.ScannerVersion = skills.ScannerVersion
	skill.RiskAcknowledgedAt = strings.TrimSpace(skill.RiskAcknowledgedAt)
	skill.RiskAcknowledgedBy = strings.TrimSpace(skill.RiskAcknowledgedBy)
	skill.RiskAcknowledgedHash = strings.TrimSpace(skill.RiskAcknowledgedHash)
	if !skill.Enabled || skill.ScanVerdict != skills.VerdictReview {
		// An acknowledgement authorizes only one enabled review state for the
		// exact scanned content hash. Safe, blocked, and disabled records carry none.
		skill.RiskAcknowledgedAt = ""
		skill.RiskAcknowledgedBy = ""
		skill.RiskAcknowledgedHash = ""
	}
	if err := validateSkill(skill); err != nil {
		return Skill{}, err
	}
	return skill, nil
}

func validSkillRiskAcknowledgement(skill Skill) bool {
	acknowledgedAt := strings.TrimSpace(skill.RiskAcknowledgedAt)
	acknowledgedBy := strings.TrimSpace(skill.RiskAcknowledgedBy)
	acknowledgedHash := strings.TrimSpace(skill.RiskAcknowledgedHash)
	if acknowledgedAt == "" || acknowledgedBy == "" || len(acknowledgedBy) > 200 || acknowledgedHash != skill.ContentHash {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, acknowledgedAt)
	return err == nil
}

func validateSkill(skill Skill) error {
	if !validSkillName(skill.Name) {
		return errors.New("invalid skill name")
	}
	if !validSkillCommand(skill.Command) {
		return errors.New("invalid skill command")
	}
	if !validSkillDescription(skill.Description) {
		return errors.New("invalid skill description")
	}
	if strings.TrimSpace(skill.Prompt) == "" || len(skill.Prompt) > 128*1024 || !utf8.ValidString(skill.Prompt) || strings.ContainsRune(skill.Prompt, 0) {
		return errors.New("invalid skill prompt")
	}
	if !validSkillSource(skill.Source) {
		return errors.New("invalid skill source")
	}
	if !validSkillScopeTarget(skill.Scope, skill.ProjectID, skill.WorklineID) {
		return errors.New("invalid skill scope target")
	}
	if len(skill.ContentHash) != 64 || !isLowerHex(skill.ContentHash) {
		return errors.New("invalid skill content hash")
	}
	if !validSkillVerdict(skill.ScanVerdict) {
		return errors.New("invalid skill scan verdict")
	}
	findingsVerdict, findingsValid := storedSkillFindingsVerdict(skill.ScanFindings)
	if !findingsValid || findingsVerdict != skill.ScanVerdict {
		return errors.New("invalid skill scan findings")
	}
	if skill.ScanVerdict == "blocked" && skill.Enabled {
		return errors.New("blocked skills cannot be enabled")
	}
	if skill.ScanVerdict == skills.VerdictReview && skill.Enabled && !validSkillRiskAcknowledgement(skill) {
		return errors.New("review skills require a valid risk acknowledgement for the current content before enabling")
	}
	return nil
}

func validSkillName(name string) bool {
	return strings.TrimSpace(name) != "" && len(name) <= 120 && utf8.ValidString(name) && !strings.ContainsRune(name, 0)
}

func validSkillDescription(description string) bool {
	return strings.TrimSpace(description) != "" && len(description) <= 500 && utf8.ValidString(description) && !strings.ContainsRune(description, 0)
}

func validSkillCommand(command string) bool {
	if len(command) < 2 || len(command) > 64 || command[0] != '/' || strings.ToLower(command) != command {
		return false
	}
	for i := 1; i < len(command); i++ {
		char := command[i]
		if !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return false
		}
		if i == 1 && (char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func validSkillScopeTarget(scope, projectID, worklineID string) bool {
	switch scope {
	case "global":
		return projectID == "" && worklineID == ""
	case "project":
		return projectID != "" && worklineID == ""
	case "workspace":
		return projectID != "" && worklineID != ""
	default:
		return false
	}
}

func validSkillSource(source string) bool {
	switch source {
	case "manual", "local_migration", "skill_md":
		return true
	default:
		return false
	}
}

func validSkillVerdict(verdict string) bool {
	switch verdict {
	case "safe", "review", "blocked":
		return true
	default:
		return false
	}
}
