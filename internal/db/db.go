package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"autoto/internal/skills"
)

type Store struct {
	db *sql.DB
}

var ErrConflict = errors.New("conflict")

type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

type Project struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	Status        string `json:"status"`
	FlowMode      string `json:"flowMode"`
	GitPath       string `json:"gitPath,omitempty"`
	RemoteURL     string `json:"remoteUrl,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type Workline struct {
	ID                   string `json:"id"`
	ProjectID            string `json:"projectId"`
	Title                string `json:"title"`
	Description          string `json:"description,omitempty"`
	Status               string `json:"status"`
	Role                 string `json:"role"`
	Branch               string `json:"branch,omitempty"`
	WorktreePath         string `json:"worktreePath,omitempty"`
	BaseBranch           string `json:"baseBranch,omitempty"`
	ParentWorklineID     string `json:"parentWorklineId,omitempty"`
	ForkPoint            string `json:"forkPoint,omitempty"`
	MergedIntoWorklineID string `json:"mergedIntoWorklineId,omitempty"`
	MergeCommitSHA       string `json:"mergeCommitSha,omitempty"`
	MergeStrategy        string `json:"mergeStrategy,omitempty"`
	PreMergeTargetSHA    string `json:"preMergeTargetSha,omitempty"`
	HeadCommitSHA        string `json:"headCommitSha,omitempty"`
	StartCommitSHA       string `json:"startCommitSha,omitempty"`
	IsRoot               bool   `json:"isRoot"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
}

type Agent struct {
	ID                     string `json:"id"`
	WorklineID             string `json:"worklineId,omitempty"`
	Type                   string `json:"type"`
	SubagentType           string `json:"subagentType,omitempty"`
	Title                  string `json:"title"`
	Model                  string `json:"model"`
	SystemPrompt           string `json:"systemPrompt,omitempty"`
	PermissionMode         string `json:"permissionMode"`
	EntityGeneration       int64  `json:"entityGeneration"`
	PermissionGeneration   int64  `json:"permissionGeneration"`
	Status                 string `json:"status"`
	PlanMode               bool   `json:"planMode"`
	CWD                    string `json:"cwd,omitempty"`
	MessageCount           int    `json:"messageCount"`
	ContextSummary         string `json:"-"`
	PruneBoundaryMessageID string `json:"-"`
	PrunedPercent          int    `json:"-"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

type Message struct {
	ID           string          `json:"id"`
	AgentID      string          `json:"agentId"`
	RunID        string          `json:"runId,omitempty"`
	Role         string          `json:"role"`
	ContentJSON  json.RawMessage `json:"contentJson,omitempty"`
	ContentText  string          `json:"contentText"`
	ParentToolID string          `json:"parentToolUseId,omitempty"`
	CommandText  string          `json:"commandText,omitempty"`
	CreatedBy    string          `json:"createdBy,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	Attachments  []Attachment    `json:"attachments,omitempty"`
}

type Run struct {
	ID                 string `json:"id"`
	AgentID            string `json:"agentId"`
	TriggerMessageID   string `json:"triggerMessageId,omitempty"`
	Status             string `json:"status"`
	StartedAt          string `json:"startedAt"`
	CompletedAt        string `json:"completedAt,omitempty"`
	ErrorMessage       string `json:"errorMessage,omitempty"`
	BaseHead           string `json:"baseHead,omitempty"`
	EndHead            string `json:"endHead,omitempty"`
	CheckpointRepoRoot string `json:"checkpointRepoRoot,omitempty"`
	GitSnapshotAt      string `json:"gitSnapshotAt,omitempty"`
	CheckpointState    string `json:"checkpointState"`
	CheckpointError    string `json:"checkpointError,omitempty"`
	RolledBackAt       string `json:"rolledBackAt,omitempty"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

const (
	RunCheckpointNone        = "none"
	RunCheckpointTracking    = "tracking"
	RunCheckpointCapturing   = "capturing"
	RunCheckpointReady       = "ready"
	RunCheckpointRollingBack = "rolling_back"
	RunCheckpointInvalid     = "invalid"
	RunCheckpointRolledBack  = "rolled_back"
)

type RunGitChange struct {
	RunID               string `json:"runId"`
	Path                string `json:"path"`
	OrigPath            string `json:"origPath,omitempty"`
	IndexStatus         string `json:"indexStatus"`
	WorktreeStatus      string `json:"worktreeStatus"`
	Untracked           bool   `json:"untracked"`
	IndexFingerprint    string `json:"indexFingerprint,omitempty"`
	WorktreeFingerprint string `json:"worktreeFingerprint"`
}

type RunSummary struct {
	Run              Run                 `json:"run"`
	MessageCount     int64               `json:"messageCount"`
	ToolCallCount    int64               `json:"toolCallCount"`
	PendingApprovals int64               `json:"pendingApprovals"`
	DeniedToolCalls  int64               `json:"deniedToolCalls"`
	ErrorToolCalls   int64               `json:"errorToolCalls"`
	APIRequestCount  int64               `json:"apiRequestCount"`
	InputTokens      int64               `json:"inputTokens"`
	OutputTokens     int64               `json:"outputTokens"`
	CostUSD          float64             `json:"costUsd"`
	ToolCalls        []ToolCall          `json:"toolCalls"`
	RecentMessages   []RunMessagePreview `json:"recentMessages,omitempty"`
}

type RunMessagePreview struct {
	ID           string `json:"id"`
	Role         string `json:"role"`
	ContentText  string `json:"contentText"`
	ParentToolID string `json:"parentToolUseId,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

type Attachment struct {
	ID            string `json:"id"`
	MessageID     string `json:"messageId"`
	AgentID       string `json:"agentId"`
	Filename      string `json:"filename"`
	MIMEType      string `json:"mimeType"`
	Kind          string `json:"kind"`
	SizeBytes     int64  `json:"sizeBytes"`
	Data          []byte `json:"-"`
	ExtractedText string `json:"extractedText,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

type ToolCall struct {
	ID                       string          `json:"id"`
	AgentID                  string          `json:"agentId"`
	RunID                    string          `json:"runId,omitempty"`
	MessageID                string          `json:"messageId,omitempty"`
	ToolUseID                string          `json:"toolUseId"`
	ToolName                 string          `json:"toolName"`
	InputJSON                json.RawMessage `json:"inputJson,omitempty"`
	OutputJSON               json.RawMessage `json:"outputJson,omitempty"`
	Status                   string          `json:"status"`
	DurationMS               int64           `json:"durationMs,omitempty"`
	ErrorMessage             string          `json:"errorMessage,omitempty"`
	PermissionDecidedBy      string          `json:"permissionDecidedBy,omitempty"`
	PermissionDecidedAt      string          `json:"permissionDecidedAt,omitempty"`
	PermissionDenyMessage    string          `json:"permissionDenyMessage,omitempty"`
	PermissionDecisionReason string          `json:"permissionDecisionReason,omitempty"`
	PermissionSuggestions    string          `json:"permissionSuggestions,omitempty"`
	PermissionGeneration     int64           `json:"permissionGeneration"`
	PolicyGeneration         int64           `json:"policyGeneration"`
	CreatedAt                string          `json:"createdAt"`
}

type APIRequest struct {
	ID                string          `json:"id"`
	AgentID           string          `json:"agentId,omitempty"`
	RunID             string          `json:"runId,omitempty"`
	MessageID         string          `json:"messageId,omitempty"`
	Kind              string          `json:"kind"`
	Provider          string          `json:"provider,omitempty"`
	Model             string          `json:"model,omitempty"`
	InputTokens       int64           `json:"inputTokens,omitempty"`
	OutputTokens      int64           `json:"outputTokens,omitempty"`
	CachedInputTokens int64           `json:"cachedInputTokens,omitempty"`
	ReasoningTokens   int64           `json:"reasoningTokens,omitempty"`
	TTFTMS            int64           `json:"ttftMs,omitempty"`
	DurationMS        int64           `json:"durationMs,omitempty"`
	CostUSD           float64         `json:"costUsd,omitempty"`
	ErrorMessage      string          `json:"errorMessage,omitempty"`
	RawDumpJSON       json.RawMessage `json:"rawDumpJson,omitempty"`
	CreatedAt         string          `json:"createdAt"`
}

type Backend struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey,omitempty"`
	Active    bool   `json:"active"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type MCPServer struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	Command   string            `json:"command"`
	Args      []string          `json:"args,omitempty"`
	CWD       string            `json:"cwd,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   bool              `json:"enabled"`
	CreatedAt string            `json:"createdAt"`
	UpdatedAt string            `json:"updatedAt"`
}

type Skill struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	Command              string          `json:"command"`
	Description          string          `json:"description"`
	Prompt               string          `json:"prompt"`
	Source               string          `json:"source"`
	Scope                string          `json:"scope"`
	ProjectID            string          `json:"projectId,omitempty"`
	WorklineID           string          `json:"worklineId,omitempty"`
	DeletedAt            string          `json:"deletedAt,omitempty"`
	RevisionNo           int64           `json:"revisionNo"`
	ContentHash          string          `json:"contentHash"`
	Enabled              bool            `json:"enabled"`
	ScanVerdict          string          `json:"scanVerdict"`
	ScanFindings         json.RawMessage `json:"scanFindings"`
	ScannerVersion       int             `json:"scannerVersion"`
	RiskAcknowledgedAt   string          `json:"riskAcknowledgedAt,omitempty"`
	RiskAcknowledgedBy   string          `json:"riskAcknowledgedBy,omitempty"`
	RiskAcknowledgedHash string          `json:"riskAcknowledgedHash,omitempty"`
	CreatedAt            string          `json:"createdAt"`
	UpdatedAt            string          `json:"updatedAt"`
}

// SkillSummary is deliberately safe for list responses: it excludes prompt
// content and finding messages, which are fetched only for an individual skill.
type SkillSummary struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Command              string `json:"command"`
	Description          string `json:"description"`
	Source               string `json:"source"`
	Scope                string `json:"scope"`
	ProjectID            string `json:"projectId,omitempty"`
	WorklineID           string `json:"worklineId,omitempty"`
	RevisionNo           int64  `json:"revisionNo"`
	ContentHash          string `json:"contentHash"`
	Enabled              bool   `json:"enabled"`
	ScanVerdict          string `json:"scanVerdict"`
	FindingCount         int    `json:"findingCount"`
	ScannerVersion       int    `json:"scannerVersion"`
	RiskAcknowledgedAt   string `json:"riskAcknowledgedAt,omitempty"`
	RiskAcknowledgedBy   string `json:"riskAcknowledgedBy,omitempty"`
	RiskAcknowledgedHash string `json:"riskAcknowledgedHash,omitempty"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
}

type SkillScopeTarget struct {
	Scope      string `json:"scope"`
	ProjectID  string `json:"projectId,omitempty"`
	WorklineID string `json:"worklineId,omitempty"`
}

type SkillRevision struct {
	Sequence               int64           `json:"sequence"`
	ID                     string          `json:"id"`
	SkillID                string          `json:"skillId"`
	RevisionNo             int64           `json:"revisionNo"`
	Operation              string          `json:"operation"`
	Actor                  string          `json:"actor"`
	RestoredFromRevisionNo int64           `json:"restoredFromRevisionNo,omitempty"`
	Name                   string          `json:"name"`
	Command                string          `json:"command"`
	Description            string          `json:"description"`
	Prompt                 string          `json:"prompt"`
	Source                 string          `json:"source"`
	Scope                  string          `json:"scope"`
	ProjectID              string          `json:"projectId,omitempty"`
	WorklineID             string          `json:"worklineId,omitempty"`
	DeletedAt              string          `json:"deletedAt,omitempty"`
	ContentHash            string          `json:"contentHash"`
	Enabled                bool            `json:"enabled"`
	ScanVerdict            string          `json:"scanVerdict"`
	ScanFindings           json.RawMessage `json:"scanFindings"`
	ScannerVersion         int             `json:"scannerVersion"`
	RiskAcknowledgedAt     string          `json:"riskAcknowledgedAt,omitempty"`
	RiskAcknowledgedBy     string          `json:"riskAcknowledgedBy,omitempty"`
	RiskAcknowledgedHash   string          `json:"riskAcknowledgedHash,omitempty"`
	HeadCreatedAt          string          `json:"headCreatedAt"`
	HeadUpdatedAt          string          `json:"headUpdatedAt"`
	CreatedAt              string          `json:"createdAt"`
}

type SkillRevisionSummary struct {
	Sequence               int64  `json:"sequence"`
	SkillID                string `json:"skillId"`
	RevisionNo             int64  `json:"revisionNo"`
	Operation              string `json:"operation"`
	Actor                  string `json:"actor"`
	RestoredFromRevisionNo int64  `json:"restoredFromRevisionNo,omitempty"`
	ContentHash            string `json:"contentHash"`
	Enabled                bool   `json:"enabled"`
	ScanVerdict            string `json:"scanVerdict"`
	Deleted                bool   `json:"deleted"`
	CreatedAt              string `json:"createdAt"`
}

type SkillPage struct {
	Items            []SkillSummary `json:"items"`
	NextCursor       string         `json:"nextCursor,omitempty"`
	SnapshotSequence int64          `json:"snapshotSequence"`
}

type SkillRevisionPage struct {
	Items            []SkillRevisionSummary `json:"items"`
	NextCursor       string                 `json:"nextCursor,omitempty"`
	SnapshotSequence int64                  `json:"snapshotSequence"`
}

// SkillAuditEvent stores security-relevant lifecycle metadata without copying
// the prompt or scanner finding messages.
type SkillAuditEvent struct {
	ID                 string          `json:"id"`
	Action             string          `json:"action"`
	Actor              string          `json:"actor"`
	SkillID            string          `json:"skillId"`
	ContentHash        string          `json:"contentHash"`
	ScanVerdict        string          `json:"scanVerdict"`
	FindingCodes       json.RawMessage `json:"findingCodes"`
	RiskAcknowledgedAt string          `json:"riskAcknowledgedAt,omitempty"`
	CreatedAt          string          `json:"createdAt"`
}

type NotificationSettings struct {
	ID               string `json:"id"`
	Enabled          bool   `json:"enabled"`
	WebhookURL       string `json:"webhookUrl,omitempty"`
	NotifyOnApproval bool   `json:"notifyOnApproval"`
	NotifyOnDone     bool   `json:"notifyOnDone"`
	NotifyOnError    bool   `json:"notifyOnError"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type WorkflowPreferences struct {
	ID                           string `json:"id"`
	RequireConfirmationForExec   bool   `json:"requireConfirmationForExec"`
	RequireConfirmationForWrites bool   `json:"requireConfirmationForWrites"`
	AllowReadOnlyByDefault       bool   `json:"allowReadOnlyByDefault"`
	PolicyGeneration             int64  `json:"policyGeneration"`
	CreatedAt                    string `json:"createdAt"`
	UpdatedAt                    string `json:"updatedAt"`
}

type ToolPermissionRule struct {
	ID          string `json:"id"`
	Mode        string `json:"mode"`
	ToolName    string `json:"toolName"`
	Risk        string `json:"risk"`
	Decision    string `json:"decision"`
	Priority    int    `json:"priority"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func Open(ctx context.Context, path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.revalidateSkills(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) migrate(ctx context.Context) error {
	return runMigrations(ctx, s.db)
}

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

func Now() string   { return time.Now().UTC().Format(time.RFC3339Nano) }
func NewID() string { return uuid.NewString() }

func (s *Store) HasUsers(ctx context.Context) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
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
	switch name {
	case "*", "Bash", "Edit", "Glob", "Grep", "MCPCallTool", "MCPListTools", "Read", "WebFetch", "WebSearch", "Write":
		return true
	default:
		return false
	}
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

func (s *Store) CreateRun(ctx context.Context, run Run) (Run, error) {
	if run.ID == "" {
		run.ID = NewID()
	}
	now := Now()
	if run.CreatedAt == "" {
		run.CreatedAt = now
	}
	if run.UpdatedAt == "" {
		run.UpdatedAt = run.CreatedAt
	}
	if run.StartedAt == "" {
		run.StartedAt = run.CreatedAt
	}
	if run.Status == "" {
		run.Status = "running"
	}
	if run.CheckpointState == "" {
		run.CheckpointState = RunCheckpointNone
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO runs (id, agent_id, trigger_message_id, status, started_at, completed_at, error_message, base_head, end_head, checkpoint_repo_root, git_snapshot_at, checkpoint_state, checkpoint_error, rolled_back_at, created_at, updated_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)`, run.ID, run.AgentID, run.TriggerMessageID, run.Status, run.StartedAt, run.CompletedAt, run.ErrorMessage, run.BaseHead, run.EndHead, run.CheckpointRepoRoot, run.GitSnapshotAt, run.CheckpointState, run.CheckpointError, run.RolledBackAt, run.CreatedAt, run.UpdatedAt)
	if err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Store) UpdateRunStatus(ctx context.Context, runID, status, errorMessage string) error {
	if status != "running" {
		return fmt.Errorf("invalid non-terminal run status transition to %q", status)
	}
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET status = 'running', error_message = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`, now, runID)
	if err != nil {
		return err
	}
	return s.requireRunTransition(ctx, result, runID, "start")
}

func (s *Store) requireRunTransition(ctx context.Context, result sql.Result, runID, action string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		return nil
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM runs WHERE id = ?`, runID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
		return err
	}
	return fmt.Errorf("%w: run cannot %s: %s", ErrConflict, action, runID)
}

func checkpointTransitionError(runID, action string) error {
	return fmt.Errorf("run checkpoint cannot %s: %s", action, runID)
}

func requireCheckpointTransition(result sql.Result, runID, action string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return checkpointTransitionError(runID, action)
	}
	return nil
}

func (s *Store) BeginRunGitCheckpoint(ctx context.Context, runID, baseHead, repoRoot string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM run_git_changes WHERE run_id = ?`, runID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE runs SET base_head = NULLIF(?, ''), end_head = NULL, checkpoint_repo_root = NULLIF(?, ''), git_snapshot_at = NULL, checkpoint_state = ?, checkpoint_error = NULL, rolled_back_at = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, strings.TrimSpace(baseHead), strings.TrimSpace(repoRoot), RunCheckpointTracking, Now(), runID, RunCheckpointNone)
	if err != nil {
		return err
	}
	if err := requireCheckpointTransition(result, runID, "begin tracking"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) MarkRunGitCheckpointCapturing(ctx context.Context, runID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET checkpoint_state = ?, checkpoint_error = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointCapturing, Now(), runID, RunCheckpointTracking)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected != 1 {
		return errors.New("run checkpoint is not tracking")
	}
	return nil
}

func (s *Store) ReplaceRunGitCheckpointChanges(ctx context.Context, runID string, changes []RunGitChange) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM run_git_changes WHERE run_id = ?`, runID); err != nil {
		return err
	}
	for _, change := range changes {
		change.RunID = runID
		if _, err := tx.ExecContext(ctx, `INSERT INTO run_git_changes (run_id, path, orig_path, index_status, worktree_status, untracked, index_fingerprint, worktree_fingerprint) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), ?)`, change.RunID, change.Path, change.OrigPath, change.IndexStatus, change.WorktreeStatus, boolInt(change.Untracked), change.IndexFingerprint, change.WorktreeFingerprint); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE runs SET checkpoint_state = ?, checkpoint_error = NULL, end_head = NULL, git_snapshot_at = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointTracking, Now(), runID, RunCheckpointCapturing)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected != 1 {
		return errors.New("run checkpoint is not capturing")
	}
	return tx.Commit()
}

func (s *Store) InvalidateRunGitCheckpoint(ctx context.Context, runID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "run checkpoint capture failed"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var state string
	if err := tx.QueryRowContext(ctx, `SELECT checkpoint_state FROM runs WHERE id = ?`, runID).Scan(&state); err != nil {
		return err
	}
	if state == RunCheckpointRolledBack {
		return checkpointTransitionError(runID, "invalidate a rolled back checkpoint")
	}
	if state != RunCheckpointTracking && state != RunCheckpointCapturing {
		return checkpointTransitionError(runID, "invalidate from the current state")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM run_git_changes WHERE run_id = ?`, runID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE runs SET end_head = NULL, git_snapshot_at = NULL, checkpoint_state = ?, checkpoint_error = ?, rolled_back_at = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointInvalid, reason, Now(), runID, state)
	if err != nil {
		return err
	}
	if err := requireCheckpointTransition(result, runID, "invalidate"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FinalizeRunGitCheckpoint(ctx context.Context, runID, endHead string) (bool, error) {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET end_head = NULLIF(?, ''), git_snapshot_at = ?, checkpoint_state = ?, checkpoint_error = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, strings.TrimSpace(endHead), now, RunCheckpointReady, now, runID, RunCheckpointTracking)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected == 1, nil
}

func (s *Store) ClaimRunGitRollback(ctx context.Context, runID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET checkpoint_state = ?, checkpoint_error = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointRollingBack, Now(), runID, RunCheckpointReady)
	if err != nil {
		return err
	}
	return requireCheckpointTransition(result, runID, "start rollback")
}

func (s *Store) MarkRunGitCheckpointRolledBack(ctx context.Context, runID string) error {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET checkpoint_state = ?, rolled_back_at = ?, checkpoint_error = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointRolledBack, now, now, runID, RunCheckpointRollingBack)
	if err != nil {
		return err
	}
	return requireCheckpointTransition(result, runID, "finish rollback")
}

func (s *Store) FailRunGitRollback(ctx context.Context, runID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "rollback failed"
	}
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET checkpoint_state = ?, checkpoint_error = ?, rolled_back_at = NULL, updated_at = ? WHERE id = ? AND checkpoint_state = ?`, RunCheckpointInvalid, reason, Now(), runID, RunCheckpointRollingBack)
	if err != nil {
		return err
	}
	return requireCheckpointTransition(result, runID, "mark rollback failure")
}

func (s *Store) ListRunGitChanges(ctx context.Context, runID string) ([]RunGitChange, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT run_id, path, COALESCE(orig_path,''), index_status, worktree_status, untracked, COALESCE(index_fingerprint,''), worktree_fingerprint FROM run_git_changes WHERE run_id = ? ORDER BY path ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	changes := make([]RunGitChange, 0)
	for rows.Next() {
		var change RunGitChange
		var untracked int
		if err := rows.Scan(&change.RunID, &change.Path, &change.OrigPath, &change.IndexStatus, &change.WorktreeStatus, &untracked, &change.IndexFingerprint, &change.WorktreeFingerprint); err != nil {
			return nil, err
		}
		change.Untracked = untracked != 0
		changes = append(changes, change)
	}
	return changes, rows.Err()
}

func (s *Store) CompleteRun(ctx context.Context, runID, status, errorMessage string) error {
	// Direct runner tests and legacy callers may run without durable tracking.
	// There is no row to transition in that mode, so preserve the prior no-op.
	if strings.TrimSpace(runID) == "" {
		return nil
	}
	var allowed string
	switch status {
	case "interrupted", "error":
		allowed = "('pending', 'running')"
	case "completed":
		allowed = "('running')"
	case "superseded":
		// Pending is included for latest-wins queue replacement; without it a
		// third queued submission would leave the replaced pending run stranded.
		allowed = "('pending', 'running')"
	default:
		return fmt.Errorf("invalid terminal run status %q", status)
	}
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET status = ?, completed_at = ?, error_message = NULLIF(?, ''), updated_at = ? WHERE id = ? AND status IN `+allowed, status, now, errorMessage, now, runID)
	if err != nil {
		return err
	}
	return s.requireRunTransition(ctx, result, runID, status)
}

func (s *Store) RecoverInterruptedRun(ctx context.Context, runID string) error {
	const restartReason = "process restarted"
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var agentID string
	if err := tx.QueryRowContext(ctx, `SELECT agent_id FROM runs WHERE id = ?`, runID).Scan(&agentID); err != nil {
		return err
	}
	now := Now()
	result, err := tx.ExecContext(ctx, `UPDATE runs SET status = 'interrupted', completed_at = ?, error_message = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'running')`, now, restartReason, now, runID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return fmt.Errorf("run is not recoverable after process restart: %s", runID)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET status = 'interrupted', error_message = ?, updated_at = ? WHERE id = ?`, restartReason, now, agentID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agent_tool_calls SET status = 'denied', error_message = ?, permission_decided_by = 'system', permission_decided_at = ?, permission_deny_message = ?, permission_decision_reason = ?, permission_suggestions = NULL WHERE run_id = ? AND status IN ('pending_approval', 'approved', 'running')`, restartReason, now, restartReason, restartReason, runID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetRun(ctx context.Context, agentID, runID string) (Run, error) {
	var run Run
	err := s.db.QueryRowContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, started_at, COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE agent_id = ? AND id = ?`, agentID, runID).Scan(&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead, &run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt)
	return run, err
}

func (s *Store) GetRunByID(ctx context.Context, runID string) (Run, error) {
	var run Run
	err := s.db.QueryRowContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, started_at, COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE id = ?`, runID).Scan(&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead, &run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt)
	return run, err
}

func (s *Store) ListRuns(ctx context.Context, agentID string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, started_at, COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?`, agentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := make([]Run, 0)
	for rows.Next() {
		var run Run
		if err := rows.Scan(&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead, &run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) ListRecoverableRuns(ctx context.Context) ([]Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, started_at, COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE status IN ('pending', 'running') ORDER BY started_at ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := make([]Run, 0)
	for rows.Next() {
		var run Run
		if err := rows.Scan(&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead, &run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) ListRollingBackRuns(ctx context.Context) ([]Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(trigger_message_id,''), status, started_at, COALESCE(completed_at,''), COALESCE(error_message,''), COALESCE(base_head,''), COALESCE(end_head,''), COALESCE(checkpoint_repo_root,''), COALESCE(git_snapshot_at,''), COALESCE(checkpoint_state,'none'), COALESCE(checkpoint_error,''), COALESCE(rolled_back_at,''), created_at, updated_at FROM runs WHERE checkpoint_state = ? ORDER BY started_at ASC, id ASC`, RunCheckpointRollingBack)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := make([]Run, 0)
	for rows.Next() {
		var run Run
		if err := rows.Scan(&run.ID, &run.AgentID, &run.TriggerMessageID, &run.Status, &run.StartedAt, &run.CompletedAt, &run.ErrorMessage, &run.BaseHead, &run.EndHead, &run.CheckpointRepoRoot, &run.GitSnapshotAt, &run.CheckpointState, &run.CheckpointError, &run.RolledBackAt, &run.CreatedAt, &run.UpdatedAt); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, COALESCE(description,''), status, flow_mode, COALESCE(git_path,''), COALESCE(remote_url,''), COALESCE(default_branch,''), created_at, updated_at FROM projects ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]Project, 0)
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Status, &p.FlowMode, &p.GitPath, &p.RemoteURL, &p.DefaultBranch, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) CreateProject(ctx context.Context, name, description, gitPath string, defaultModel, permissionMode string) (Project, Workline, Agent, error) {
	if name == "" {
		return Project{}, Workline{}, Agent{}, errors.New("name is required")
	}
	now := Now()
	project := Project{ID: NewID(), Name: name, Description: description, Status: "active", FlowMode: "workspace", GitPath: gitPath, CreatedAt: now, UpdatedAt: now}
	workline := Workline{ID: NewID(), ProjectID: project.ID, Title: "main", Status: "active", Role: "root", WorktreePath: gitPath, IsRoot: true, CreatedAt: now, UpdatedAt: now}
	agent := Agent{ID: NewID(), WorklineID: workline.ID, Type: "primary", Title: name, Model: defaultModel, PermissionMode: permissionMode, Status: "idle", CWD: gitPath, CreatedAt: now, UpdatedAt: now}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, Workline{}, Agent{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO projects (id, name, description, status, flow_mode, git_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, project.ID, project.Name, project.Description, project.Status, project.FlowMode, project.GitPath, project.CreatedAt, project.UpdatedAt); err != nil {
		return Project{}, Workline{}, Agent{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO worklines (id, project_id, title, status, role, worktree_path, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, workline.ID, workline.ProjectID, workline.Title, workline.Status, workline.Role, workline.WorktreePath, boolInt(workline.IsRoot), workline.CreatedAt, workline.UpdatedAt); err != nil {
		return Project{}, Workline{}, Agent{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agents (id, workline_id, type, title, model, permission_mode, status, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, agent.ID, agent.WorklineID, agent.Type, agent.Title, agent.Model, agent.PermissionMode, agent.Status, agent.CWD, agent.CreatedAt, agent.UpdatedAt); err != nil {
		return Project{}, Workline{}, Agent{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, Workline{}, Agent{}, err
	}
	return project, workline, agent, nil
}

func (s *Store) GetProject(ctx context.Context, id string) (Project, error) {
	var p Project
	err := s.db.QueryRowContext(ctx, `SELECT id, name, COALESCE(description,''), status, flow_mode, COALESCE(git_path,''), COALESCE(remote_url,''), COALESCE(default_branch,''), created_at, updated_at FROM projects WHERE id = ?`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Status, &p.FlowMode, &p.GitPath, &p.RemoteURL, &p.DefaultBranch, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func (s *Store) ListWorklinesByProject(ctx context.Context, projectID string) ([]Workline, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, project_id, title, COALESCE(description,''), status, role, COALESCE(branch,''), COALESCE(worktree_path,''), COALESCE(base_branch,''), COALESCE(parent_workline_id,''), COALESCE(fork_point,''), COALESCE(merged_into_workline_id,''), COALESCE(merge_commit_sha,''), COALESCE(merge_strategy,''), COALESCE(pre_merge_target_sha,''), COALESCE(head_commit_sha,''), COALESCE(start_commit_sha,''), is_root, created_at, updated_at FROM worklines WHERE project_id = ? ORDER BY is_root DESC, created_at ASC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	worklines := make([]Workline, 0)
	for rows.Next() {
		var c Workline
		var isRoot int
		if err := rows.Scan(&c.ID, &c.ProjectID, &c.Title, &c.Description, &c.Status, &c.Role, &c.Branch, &c.WorktreePath, &c.BaseBranch, &c.ParentWorklineID, &c.ForkPoint, &c.MergedIntoWorklineID, &c.MergeCommitSHA, &c.MergeStrategy, &c.PreMergeTargetSHA, &c.HeadCommitSHA, &c.StartCommitSHA, &isRoot, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.IsRoot = isRoot != 0
		worklines = append(worklines, c)
	}
	return worklines, rows.Err()
}

func (s *Store) GetWorkline(ctx context.Context, id string) (Workline, error) {
	var c Workline
	var isRoot int
	err := s.db.QueryRowContext(ctx, `SELECT id, project_id, title, COALESCE(description,''), status, role, COALESCE(branch,''), COALESCE(worktree_path,''), COALESCE(base_branch,''), COALESCE(parent_workline_id,''), COALESCE(fork_point,''), COALESCE(merged_into_workline_id,''), COALESCE(merge_commit_sha,''), COALESCE(merge_strategy,''), COALESCE(pre_merge_target_sha,''), COALESCE(head_commit_sha,''), COALESCE(start_commit_sha,''), is_root, created_at, updated_at FROM worklines WHERE id = ?`, id).Scan(&c.ID, &c.ProjectID, &c.Title, &c.Description, &c.Status, &c.Role, &c.Branch, &c.WorktreePath, &c.BaseBranch, &c.ParentWorklineID, &c.ForkPoint, &c.MergedIntoWorklineID, &c.MergeCommitSHA, &c.MergeStrategy, &c.PreMergeTargetSHA, &c.HeadCommitSHA, &c.StartCommitSHA, &isRoot, &c.CreatedAt, &c.UpdatedAt)
	c.IsRoot = isRoot != 0
	return c, err
}

func (s *Store) CreateWorklineFork(ctx context.Context, parent Workline, title, branch, worktreePath, baseBranch, forkPoint, model, permissionMode string) (Workline, Agent, error) {
	if parent.ID == "" || parent.ProjectID == "" {
		return Workline{}, Agent{}, errors.New("parent workline is required")
	}
	if title == "" {
		title = branch
	}
	if title == "" {
		return Workline{}, Agent{}, errors.New("workline title is required")
	}
	if branch == "" {
		return Workline{}, Agent{}, errors.New("branch is required")
	}
	if worktreePath == "" {
		return Workline{}, Agent{}, errors.New("worktree path is required")
	}
	now := Now()
	workline := Workline{ID: NewID(), ProjectID: parent.ProjectID, Title: title, Status: "active", Role: "worktree", Branch: branch, WorktreePath: worktreePath, BaseBranch: baseBranch, ParentWorklineID: parent.ID, ForkPoint: forkPoint, HeadCommitSHA: forkPoint, StartCommitSHA: forkPoint, IsRoot: false, CreatedAt: now, UpdatedAt: now}
	agent := Agent{ID: NewID(), WorklineID: workline.ID, Type: "primary", Title: title, Model: model, PermissionMode: permissionMode, Status: "idle", CWD: worktreePath, CreatedAt: now, UpdatedAt: now}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Workline{}, Agent{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO worklines (id, project_id, title, status, role, branch, worktree_path, base_branch, parent_workline_id, fork_point, head_commit_sha, start_commit_sha, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)`, workline.ID, workline.ProjectID, workline.Title, workline.Status, workline.Role, workline.Branch, workline.WorktreePath, workline.BaseBranch, workline.ParentWorklineID, workline.ForkPoint, workline.HeadCommitSHA, workline.StartCommitSHA, boolInt(workline.IsRoot), workline.CreatedAt, workline.UpdatedAt); err != nil {
		return Workline{}, Agent{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agents (id, workline_id, type, title, model, permission_mode, status, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, agent.ID, agent.WorklineID, agent.Type, agent.Title, agent.Model, agent.PermissionMode, agent.Status, agent.CWD, agent.CreatedAt, agent.UpdatedAt); err != nil {
		return Workline{}, Agent{}, err
	}
	if err := tx.Commit(); err != nil {
		return Workline{}, Agent{}, err
	}
	return workline, agent, nil
}

func (s *Store) MarkWorklineMerged(ctx context.Context, sourceWorklineID, targetWorklineID, preMergeTargetSHA, mergeCommitSHA, strategy string) (Workline, error) {
	if sourceWorklineID == "" || targetWorklineID == "" || mergeCommitSHA == "" {
		return Workline{}, errors.New("source workline, target workline, and merge commit are required")
	}
	now := Now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Workline{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE worklines SET status = 'merged', merged_into_workline_id = ?, merge_commit_sha = ?, merge_strategy = NULLIF(?, ''), pre_merge_target_sha = NULLIF(?, ''), head_commit_sha = ?, updated_at = ? WHERE id = ?`, targetWorklineID, mergeCommitSHA, strategy, preMergeTargetSHA, mergeCommitSHA, now, sourceWorklineID); err != nil {
		return Workline{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE worklines SET head_commit_sha = ?, updated_at = ? WHERE id = ?`, mergeCommitSHA, now, targetWorklineID); err != nil {
		return Workline{}, err
	}
	if err := tx.Commit(); err != nil {
		return Workline{}, err
	}
	return s.GetWorkline(ctx, sourceWorklineID)
}

func (s *Store) GetAgent(ctx context.Context, id string) (Agent, error) {
	var n Agent
	var planMode int
	err := s.db.QueryRowContext(ctx, `SELECT id, COALESCE(workline_id,''), type, COALESCE(subagent_type,''), title, model, COALESCE(system_prompt,''), permission_mode, COALESCE(entity_generation,1), COALESCE(permission_generation,1), status, plan_mode, COALESCE(cwd,''), message_count, COALESCE(context_summary,''), COALESCE(prune_boundary_message_id,''), COALESCE(pruned_percent,0), created_at, updated_at FROM agents WHERE id = ?`, id).Scan(&n.ID, &n.WorklineID, &n.Type, &n.SubagentType, &n.Title, &n.Model, &n.SystemPrompt, &n.PermissionMode, &n.EntityGeneration, &n.PermissionGeneration, &n.Status, &planMode, &n.CWD, &n.MessageCount, &n.ContextSummary, &n.PruneBoundaryMessageID, &n.PrunedPercent, &n.CreatedAt, &n.UpdatedAt)
	n.PlanMode = planMode != 0
	return n, err
}

func (s *Store) UpdateAgentCWD(ctx context.Context, id, cwd string) (Agent, error) {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE agents SET cwd = ?, entity_generation = entity_generation + 1, permission_generation = permission_generation + 1, updated_at = ? WHERE id = ?`, cwd, now, id)
	if err != nil {
		return Agent{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return Agent{}, err
	} else if affected != 1 {
		return Agent{}, sql.ErrNoRows
	}
	return s.GetAgent(ctx, id)
}

func (s *Store) UpdateAgentModel(ctx context.Context, id, model string) (Agent, error) {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE agents SET model = ?, entity_generation = entity_generation + 1, updated_at = ? WHERE id = ?`, model, now, id)
	if err != nil {
		return Agent{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return Agent{}, err
	} else if affected != 1 {
		return Agent{}, sql.ErrNoRows
	}
	return s.GetAgent(ctx, id)
}

func (s *Store) UpdateAgentContextSummary(ctx context.Context, id, summary, boundaryMessageID string, prunedPercent int) error {
	now := Now()
	_, err := s.db.ExecContext(ctx, `UPDATE agents SET context_summary = NULLIF(?, ''), prune_boundary_message_id = NULLIF(?, ''), pruned_percent = ?, prune_enabled = 1, updated_at = ? WHERE id = ?`, summary, boundaryMessageID, prunedPercent, now, id)
	return err
}

func (s *Store) UpdateAgentPermissionMode(ctx context.Context, id, mode string) (Agent, error) {
	now := Now()
	result, err := s.db.ExecContext(ctx, `UPDATE agents SET permission_mode = ?, entity_generation = entity_generation + 1, permission_generation = permission_generation + 1, updated_at = ? WHERE id = ?`, mode, now, id)
	if err != nil {
		return Agent{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return Agent{}, err
	} else if affected != 1 {
		return Agent{}, sql.ErrNoRows
	}
	return s.GetAgent(ctx, id)
}

func (s *Store) ListAgentsByWorkline(ctx context.Context, worklineID string) ([]Agent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(workline_id,''), type, COALESCE(subagent_type,''), title, model, COALESCE(system_prompt,''), permission_mode, COALESCE(entity_generation,1), COALESCE(permission_generation,1), status, plan_mode, COALESCE(cwd,''), message_count, COALESCE(context_summary,''), COALESCE(prune_boundary_message_id,''), COALESCE(pruned_percent,0), created_at, updated_at FROM agents WHERE workline_id = ? ORDER BY type ASC, created_at ASC`, worklineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	agents := make([]Agent, 0)
	for rows.Next() {
		var n Agent
		var planMode int
		if err := rows.Scan(&n.ID, &n.WorklineID, &n.Type, &n.SubagentType, &n.Title, &n.Model, &n.SystemPrompt, &n.PermissionMode, &n.EntityGeneration, &n.PermissionGeneration, &n.Status, &planMode, &n.CWD, &n.MessageCount, &n.ContextSummary, &n.PruneBoundaryMessageID, &n.PrunedPercent, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.PlanMode = planMode != 0
		agents = append(agents, n)
	}
	return agents, rows.Err()
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
	createdBy := msg.CreatedBy
	if createdBy == "api" {
		createdBy = ""
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_messages (id, agent_id, run_id, parent_tool_use_id, role, content_json, content_text, command_text, created_by, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, NULLIF(?, ''), ?)`, msg.ID, msg.AgentID, msg.RunID, nullEmpty(msg.ParentToolID), msg.Role, string(msg.ContentJSON), msg.ContentText, nullEmpty(msg.CommandText), createdBy, msg.CreatedAt); err != nil {
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

func (s *Store) listMessages(ctx context.Context, agentID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), role, COALESCE(content_json,''), COALESCE(content_text,''), COALESCE(parent_tool_use_id,''), COALESCE(command_text,''), COALESCE(created_by,''), created_at FROM agent_messages WHERE agent_id = ? ORDER BY created_at ASC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]Message, 0)
	for rows.Next() {
		var m Message
		var raw string
		if err := rows.Scan(&m.ID, &m.AgentID, &m.RunID, &m.Role, &raw, &m.ContentText, &m.ParentToolID, &m.CommandText, &m.CreatedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		if raw != "" {
			m.ContentJSON = json.RawMessage(raw)
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
	if call.PermissionGeneration < 1 {
		call.PermissionGeneration = 1
	}
	if call.PolicyGeneration < 1 {
		call.PolicyGeneration = 1
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_tool_calls (id, agent_id, run_id, message_id, tool_use_id, tool_name, input_json, output_json, status, duration_ms, error_message, permission_decided_by, permission_decided_at, permission_deny_message, permission_decision_reason, permission_suggestions, permission_generation, policy_generation, created_at) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)`, call.ID, call.AgentID, call.RunID, call.MessageID, call.ToolUseID, call.ToolName, string(call.InputJSON), string(call.OutputJSON), call.Status, call.DurationMS, call.ErrorMessage, call.PermissionDecidedBy, call.PermissionDecidedAt, call.PermissionDenyMessage, call.PermissionDecisionReason, call.PermissionSuggestions, call.PermissionGeneration, call.PolicyGeneration, call.CreatedAt)
	if err != nil {
		return ToolCall{}, err
	}
	return call, nil
}

func (s *Store) GetToolCallByUseID(ctx context.Context, agentID, toolUseID string) (ToolCall, error) {
	var c ToolCall
	var input, output string
	err := s.db.QueryRowContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(permission_deny_message,''), COALESCE(permission_decision_reason,''), COALESCE(permission_suggestions,''), COALESCE(permission_generation,1), COALESCE(policy_generation,1), created_at FROM agent_tool_calls WHERE agent_id = ? AND tool_use_id = ?`, agentID, toolUseID).Scan(&c.ID, &c.AgentID, &c.RunID, &c.MessageID, &c.ToolUseID, &c.ToolName, &input, &output, &c.Status, &c.DurationMS, &c.ErrorMessage, &c.PermissionDecidedBy, &c.PermissionDecidedAt, &c.PermissionDenyMessage, &c.PermissionDecisionReason, &c.PermissionSuggestions, &c.PermissionGeneration, &c.PolicyGeneration, &c.CreatedAt)
	if input != "" {
		c.InputJSON = json.RawMessage(input)
	}
	if output != "" {
		c.OutputJSON = json.RawMessage(output)
	}
	return c, err
}

func (s *Store) UpdateToolCallApproval(ctx context.Context, agentID, toolUseID, status, decidedBy, denyMessage, reason, suggestions string) error {
	decidedAt := Now()
	_, err := s.db.ExecContext(ctx, `UPDATE agent_tool_calls SET status = ?, permission_decided_by = NULLIF(?, ''), permission_decided_at = ?, permission_deny_message = NULLIF(?, ''), permission_decision_reason = NULLIF(?, ''), permission_suggestions = NULLIF(?, '') WHERE agent_id = ? AND tool_use_id = ?`, status, decidedBy, decidedAt, denyMessage, reason, suggestions, agentID, toolUseID)
	return err
}

func (s *Store) UpdateToolCallResult(ctx context.Context, agentID, toolUseID string, outputJSON json.RawMessage, status string, durationMS int64, errorMessage string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_tool_calls SET output_json = ?, status = ?, duration_ms = ?, error_message = NULLIF(?, '') WHERE agent_id = ? AND tool_use_id = ?`, string(outputJSON), status, durationMS, errorMessage, agentID, toolUseID)
	return err
}

func (s *Store) ListPendingToolCalls(ctx context.Context, agentID string) ([]ToolCall, error) {
	return s.listToolCalls(ctx, `WHERE agent_id = ? AND status = 'pending_approval' ORDER BY created_at ASC`, agentID)
}

func (s *Store) ListToolCallsByRun(ctx context.Context, agentID, runID string) ([]ToolCall, error) {
	return s.listToolCalls(ctx, `WHERE agent_id = ? AND run_id = ? ORDER BY created_at ASC`, agentID, runID)
}

func (s *Store) listToolCalls(ctx context.Context, where string, args ...any) ([]ToolCall, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, COALESCE(run_id,''), COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), COALESCE(permission_decided_by,''), COALESCE(permission_decided_at,''), COALESCE(permission_deny_message,''), COALESCE(permission_decision_reason,''), COALESCE(permission_suggestions,''), COALESCE(permission_generation,1), COALESCE(policy_generation,1), created_at FROM agent_tool_calls `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	calls := make([]ToolCall, 0)
	for rows.Next() {
		var c ToolCall
		var input, output string
		if err := rows.Scan(&c.ID, &c.AgentID, &c.RunID, &c.MessageID, &c.ToolUseID, &c.ToolName, &input, &output, &c.Status, &c.DurationMS, &c.ErrorMessage, &c.PermissionDecidedBy, &c.PermissionDecidedAt, &c.PermissionDenyMessage, &c.PermissionDecisionReason, &c.PermissionSuggestions, &c.PermissionGeneration, &c.PolicyGeneration, &c.CreatedAt); err != nil {
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
	summary.ToolCalls, err = s.ListToolCallsByRun(ctx, agentID, runID)
	if err != nil {
		return RunSummary{}, err
	}
	summary.RecentMessages, err = s.listRunMessagePreviews(ctx, agentID, runID, 6)
	if err != nil {
		return RunSummary{}, err
	}
	return summary, nil
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
	_, err := s.db.ExecContext(ctx, `INSERT INTO api_requests (id, agent_id, run_id, message_id, kind, provider, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, ttft_ms, duration_ms, cost_usd, error_message, raw_dump_json, created_at) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?)`, request.ID, request.AgentID, request.RunID, request.MessageID, request.Kind, request.Provider, request.Model, request.InputTokens, request.OutputTokens, request.CachedInputTokens, request.ReasoningTokens, request.TTFTMS, request.DurationMS, request.CostUSD, request.ErrorMessage, string(request.RawDumpJSON), request.CreatedAt)
	if err != nil {
		return APIRequest{}, err
	}
	return request, nil
}

func (s *Store) SetAgentStatus(ctx context.Context, agentID, status, errorMessage string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agents SET status = ?, error_message = NULLIF(?, ''), updated_at = ? WHERE id = ?`, status, errorMessage, Now(), agentID)
	return err
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

func nullEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
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

func isLowerHex(value string) bool {
	for _, char := range value {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') {
			return false
		}
	}
	return true
}

func isUniqueConstraint(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "constraint failed: unique")
}

func IsNotFound(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func IsConflict(err error) bool {
	return errors.Is(err, ErrConflict)
}

func WrapNotFound(name, id string, err error) error {
	if IsNotFound(err) {
		return fmt.Errorf("%s not found: %s", name, id)
	}
	return err
}
