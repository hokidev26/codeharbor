package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

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

type Chapter struct {
	ID           string `json:"id"`
	ProjectID    string `json:"projectId"`
	Title        string `json:"title"`
	Description  string `json:"description,omitempty"`
	Status       string `json:"status"`
	Role         string `json:"role"`
	Branch       string `json:"branch,omitempty"`
	WorktreePath string `json:"worktreePath,omitempty"`
	BaseBranch   string `json:"baseBranch,omitempty"`
	IsRoot       bool   `json:"isRoot"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type Narrator struct {
	ID             string `json:"id"`
	ChapterID      string `json:"chapterId,omitempty"`
	Type           string `json:"type"`
	SubagentType   string `json:"subagentType,omitempty"`
	Title          string `json:"title"`
	Model          string `json:"model"`
	SystemPrompt   string `json:"systemPrompt,omitempty"`
	PermissionMode string `json:"permissionMode"`
	Status         string `json:"status"`
	PlanMode       bool   `json:"planMode"`
	CWD            string `json:"cwd,omitempty"`
	MessageCount   int    `json:"messageCount"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

type Message struct {
	ID           string          `json:"id"`
	NarratorID   string          `json:"narratorId"`
	Role         string          `json:"role"`
	ContentJSON  json.RawMessage `json:"contentJson,omitempty"`
	ContentText  string          `json:"contentText"`
	ParentToolID string          `json:"parentToolUseId,omitempty"`
	CommandText  string          `json:"commandText,omitempty"`
	CreatedBy    string          `json:"createdBy,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	Attachments  []Attachment    `json:"attachments,omitempty"`
}

type Attachment struct {
	ID            string `json:"id"`
	MessageID     string `json:"messageId"`
	NarratorID    string `json:"narratorId"`
	Filename      string `json:"filename"`
	MIMEType      string `json:"mimeType"`
	Kind          string `json:"kind"`
	SizeBytes     int64  `json:"sizeBytes"`
	Data          []byte `json:"-"`
	ExtractedText string `json:"extractedText,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

type ToolCall struct {
	ID           string          `json:"id"`
	NarratorID   string          `json:"narratorId"`
	MessageID    string          `json:"messageId,omitempty"`
	ToolUseID    string          `json:"toolUseId"`
	ToolName     string          `json:"toolName"`
	InputJSON    json.RawMessage `json:"inputJson,omitempty"`
	OutputJSON   json.RawMessage `json:"outputJson,omitempty"`
	Status       string          `json:"status"`
	DurationMS   int64           `json:"durationMs,omitempty"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	CreatedAt    string          `json:"createdAt"`
}

type APIRequest struct {
	ID                string          `json:"id"`
	NarratorID        string          `json:"narratorId,omitempty"`
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
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) migrate(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, schemaSQL)
	return err
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

func (s *Store) CreateProject(ctx context.Context, name, description, gitPath string, defaultModel, permissionMode string) (Project, Chapter, Narrator, error) {
	if name == "" {
		return Project{}, Chapter{}, Narrator{}, errors.New("name is required")
	}
	now := Now()
	project := Project{ID: NewID(), Name: name, Description: description, Status: "active", FlowMode: "workspace", GitPath: gitPath, CreatedAt: now, UpdatedAt: now}
	chapter := Chapter{ID: NewID(), ProjectID: project.ID, Title: "main", Status: "active", Role: "root", WorktreePath: gitPath, IsRoot: true, CreatedAt: now, UpdatedAt: now}
	narrator := Narrator{ID: NewID(), ChapterID: chapter.ID, Type: "primary", Title: name, Model: defaultModel, PermissionMode: permissionMode, Status: "idle", CWD: gitPath, CreatedAt: now, UpdatedAt: now}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, Chapter{}, Narrator{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO projects (id, name, description, status, flow_mode, git_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, project.ID, project.Name, project.Description, project.Status, project.FlowMode, project.GitPath, project.CreatedAt, project.UpdatedAt); err != nil {
		return Project{}, Chapter{}, Narrator{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO chapters (id, project_id, title, status, role, worktree_path, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, chapter.ID, chapter.ProjectID, chapter.Title, chapter.Status, chapter.Role, chapter.WorktreePath, boolInt(chapter.IsRoot), chapter.CreatedAt, chapter.UpdatedAt); err != nil {
		return Project{}, Chapter{}, Narrator{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO narrators (id, chapter_id, type, title, model, permission_mode, status, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, narrator.ID, narrator.ChapterID, narrator.Type, narrator.Title, narrator.Model, narrator.PermissionMode, narrator.Status, narrator.CWD, narrator.CreatedAt, narrator.UpdatedAt); err != nil {
		return Project{}, Chapter{}, Narrator{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, Chapter{}, Narrator{}, err
	}
	return project, chapter, narrator, nil
}

func (s *Store) GetProject(ctx context.Context, id string) (Project, error) {
	var p Project
	err := s.db.QueryRowContext(ctx, `SELECT id, name, COALESCE(description,''), status, flow_mode, COALESCE(git_path,''), COALESCE(remote_url,''), COALESCE(default_branch,''), created_at, updated_at FROM projects WHERE id = ?`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Status, &p.FlowMode, &p.GitPath, &p.RemoteURL, &p.DefaultBranch, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func (s *Store) ListChaptersByProject(ctx context.Context, projectID string) ([]Chapter, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, project_id, title, COALESCE(description,''), status, role, COALESCE(branch,''), COALESCE(worktree_path,''), COALESCE(base_branch,''), is_root, created_at, updated_at FROM chapters WHERE project_id = ? ORDER BY is_root DESC, created_at ASC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	chapters := make([]Chapter, 0)
	for rows.Next() {
		var c Chapter
		var isRoot int
		if err := rows.Scan(&c.ID, &c.ProjectID, &c.Title, &c.Description, &c.Status, &c.Role, &c.Branch, &c.WorktreePath, &c.BaseBranch, &isRoot, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.IsRoot = isRoot != 0
		chapters = append(chapters, c)
	}
	return chapters, rows.Err()
}

func (s *Store) GetChapter(ctx context.Context, id string) (Chapter, error) {
	var c Chapter
	var isRoot int
	err := s.db.QueryRowContext(ctx, `SELECT id, project_id, title, COALESCE(description,''), status, role, COALESCE(branch,''), COALESCE(worktree_path,''), COALESCE(base_branch,''), is_root, created_at, updated_at FROM chapters WHERE id = ?`, id).Scan(&c.ID, &c.ProjectID, &c.Title, &c.Description, &c.Status, &c.Role, &c.Branch, &c.WorktreePath, &c.BaseBranch, &isRoot, &c.CreatedAt, &c.UpdatedAt)
	c.IsRoot = isRoot != 0
	return c, err
}

func (s *Store) GetNarrator(ctx context.Context, id string) (Narrator, error) {
	var n Narrator
	var planMode int
	err := s.db.QueryRowContext(ctx, `SELECT id, COALESCE(chapter_id,''), type, COALESCE(subagent_type,''), title, model, COALESCE(system_prompt,''), permission_mode, status, plan_mode, COALESCE(cwd,''), message_count, created_at, updated_at FROM narrators WHERE id = ?`, id).Scan(&n.ID, &n.ChapterID, &n.Type, &n.SubagentType, &n.Title, &n.Model, &n.SystemPrompt, &n.PermissionMode, &n.Status, &planMode, &n.CWD, &n.MessageCount, &n.CreatedAt, &n.UpdatedAt)
	n.PlanMode = planMode != 0
	return n, err
}

func (s *Store) UpdateNarratorCWD(ctx context.Context, id, cwd string) (Narrator, error) {
	now := Now()
	if _, err := s.db.ExecContext(ctx, `UPDATE narrators SET cwd = ?, updated_at = ? WHERE id = ?`, cwd, now, id); err != nil {
		return Narrator{}, err
	}
	return s.GetNarrator(ctx, id)
}

func (s *Store) UpdateNarratorModel(ctx context.Context, id, model string) (Narrator, error) {
	now := Now()
	if _, err := s.db.ExecContext(ctx, `UPDATE narrators SET model = ?, updated_at = ? WHERE id = ?`, model, now, id); err != nil {
		return Narrator{}, err
	}
	return s.GetNarrator(ctx, id)
}

func (s *Store) UpdateNarratorPermissionMode(ctx context.Context, id, mode string) (Narrator, error) {
	now := Now()
	if _, err := s.db.ExecContext(ctx, `UPDATE narrators SET permission_mode = ?, updated_at = ? WHERE id = ?`, mode, now, id); err != nil {
		return Narrator{}, err
	}
	return s.GetNarrator(ctx, id)
}

func (s *Store) ListNarratorsByChapter(ctx context.Context, chapterID string) ([]Narrator, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(chapter_id,''), type, COALESCE(subagent_type,''), title, model, COALESCE(system_prompt,''), permission_mode, status, plan_mode, COALESCE(cwd,''), message_count, created_at, updated_at FROM narrators WHERE chapter_id = ? ORDER BY type ASC, created_at ASC`, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	narrators := make([]Narrator, 0)
	for rows.Next() {
		var n Narrator
		var planMode int
		if err := rows.Scan(&n.ID, &n.ChapterID, &n.Type, &n.SubagentType, &n.Title, &n.Model, &n.SystemPrompt, &n.PermissionMode, &n.Status, &planMode, &n.CWD, &n.MessageCount, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.PlanMode = planMode != 0
		narrators = append(narrators, n)
	}
	return narrators, rows.Err()
}

func (s *Store) AddMessage(ctx context.Context, msg Message) (Message, error) {
	return s.AddMessageWithAttachments(ctx, msg, msg.Attachments)
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO narrator_messages (id, narrator_id, parent_tool_use_id, role, content_json, content_text, command_text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)`, msg.ID, msg.NarratorID, nullEmpty(msg.ParentToolID), msg.Role, string(msg.ContentJSON), msg.ContentText, nullEmpty(msg.CommandText), msg.CreatedBy, msg.CreatedAt); err != nil {
		return Message{}, err
	}
	storedAttachments := make([]Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.ID == "" {
			attachment.ID = NewID()
		}
		attachment.MessageID = msg.ID
		attachment.NarratorID = msg.NarratorID
		if attachment.CreatedAt == "" {
			attachment.CreatedAt = msg.CreatedAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO narrator_message_attachments (id, message_id, narrator_id, filename, mime_type, kind, size_bytes, data_blob, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, attachment.ID, attachment.MessageID, attachment.NarratorID, attachment.Filename, attachment.MIMEType, attachment.Kind, attachment.SizeBytes, attachment.Data, attachment.ExtractedText, attachment.CreatedAt); err != nil {
			return Message{}, err
		}
		storedAttachments = append(storedAttachments, attachment)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE narrators SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?`, msg.CreatedAt, msg.CreatedAt, msg.NarratorID); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	msg.Attachments = attachmentMetadata(storedAttachments)
	return msg, nil
}

func (s *Store) ListMessages(ctx context.Context, narratorID string) ([]Message, error) {
	messages, err := s.listMessages(ctx, narratorID)
	if err != nil {
		return nil, err
	}
	if err := s.populateMessageAttachments(ctx, messages, false); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *Store) ListMessagesWithAttachmentData(ctx context.Context, narratorID string) ([]Message, error) {
	messages, err := s.listMessages(ctx, narratorID)
	if err != nil {
		return nil, err
	}
	if err := s.populateMessageAttachments(ctx, messages, true); err != nil {
		return nil, err
	}
	return messages, nil
}

func (s *Store) listMessages(ctx context.Context, narratorID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, narrator_id, role, COALESCE(content_json,''), COALESCE(content_text,''), COALESCE(parent_tool_use_id,''), COALESCE(command_text,''), COALESCE(created_by,''), created_at FROM narrator_messages WHERE narrator_id = ? ORDER BY created_at ASC`, narratorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]Message, 0)
	for rows.Next() {
		var m Message
		var raw string
		if err := rows.Scan(&m.ID, &m.NarratorID, &m.Role, &raw, &m.ContentText, &m.ParentToolID, &m.CommandText, &m.CreatedBy, &m.CreatedAt); err != nil {
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
	rows, err := s.db.QueryContext(ctx, `SELECT id, message_id, narrator_id, filename, COALESCE(mime_type,''), kind, size_bytes, `+selectData+`, `+selectText+`, created_at FROM narrator_message_attachments WHERE message_id = ? ORDER BY created_at ASC`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attachments := make([]Attachment, 0)
	for rows.Next() {
		var attachment Attachment
		var data []byte
		if err := rows.Scan(&attachment.ID, &attachment.MessageID, &attachment.NarratorID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &data, &attachment.ExtractedText, &attachment.CreatedAt); err != nil {
			return nil, err
		}
		if includeData {
			attachment.Data = data
		}
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func (s *Store) GetAttachment(ctx context.Context, narratorID, messageID, attachmentID string) (Attachment, error) {
	var attachment Attachment
	err := s.db.QueryRowContext(ctx, `SELECT id, message_id, narrator_id, filename, COALESCE(mime_type,''), kind, size_bytes, data_blob, COALESCE(extracted_text,''), created_at FROM narrator_message_attachments WHERE narrator_id = ? AND message_id = ? AND id = ?`, narratorID, messageID, attachmentID).Scan(&attachment.ID, &attachment.MessageID, &attachment.NarratorID, &attachment.Filename, &attachment.MIMEType, &attachment.Kind, &attachment.SizeBytes, &attachment.Data, &attachment.ExtractedText, &attachment.CreatedAt)
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
	_, err := s.db.ExecContext(ctx, `INSERT INTO narrator_tool_calls (id, narrator_id, message_id, tool_use_id, tool_name, input_json, output_json, status, duration_ms, error_message, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)`, call.ID, call.NarratorID, call.MessageID, call.ToolUseID, call.ToolName, string(call.InputJSON), string(call.OutputJSON), call.Status, call.DurationMS, call.ErrorMessage, call.CreatedAt)
	if err != nil {
		return ToolCall{}, err
	}
	return call, nil
}

func (s *Store) GetToolCallByUseID(ctx context.Context, narratorID, toolUseID string) (ToolCall, error) {
	var c ToolCall
	var input, output string
	err := s.db.QueryRowContext(ctx, `SELECT id, narrator_id, COALESCE(message_id,''), tool_use_id, tool_name, COALESCE(input_json,''), COALESCE(output_json,''), status, COALESCE(duration_ms,0), COALESCE(error_message,''), created_at FROM narrator_tool_calls WHERE narrator_id = ? AND tool_use_id = ?`, narratorID, toolUseID).Scan(&c.ID, &c.NarratorID, &c.MessageID, &c.ToolUseID, &c.ToolName, &input, &output, &c.Status, &c.DurationMS, &c.ErrorMessage, &c.CreatedAt)
	if input != "" {
		c.InputJSON = json.RawMessage(input)
	}
	if output != "" {
		c.OutputJSON = json.RawMessage(output)
	}
	return c, err
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
	_, err := s.db.ExecContext(ctx, `INSERT INTO api_requests (id, narrator_id, message_id, kind, provider, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, ttft_ms, duration_ms, cost_usd, error_message, raw_dump_json, created_at) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?)`, request.ID, request.NarratorID, request.MessageID, request.Kind, request.Provider, request.Model, request.InputTokens, request.OutputTokens, request.CachedInputTokens, request.ReasoningTokens, request.TTFTMS, request.DurationMS, request.CostUSD, request.ErrorMessage, string(request.RawDumpJSON), request.CreatedAt)
	if err != nil {
		return APIRequest{}, err
	}
	return request, nil
}

func (s *Store) SetNarratorStatus(ctx context.Context, narratorID, status, errorMessage string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE narrators SET status = ?, error_message = NULLIF(?, ''), updated_at = ? WHERE id = ?`, status, errorMessage, Now(), narratorID)
	return err
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

func IsNotFound(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func WrapNotFound(name, id string, err error) error {
	if IsNotFound(err) {
		return fmt.Errorf("%s not found: %s", name, id)
	}
	return err
}
