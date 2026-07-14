package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestNavigationReturnsProjectsAndSafeConversations(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, err = store.DB().ExecContext(ctx, `
INSERT INTO projects (id, name, description, status, flow_mode, git_path, created_at, updated_at) VALUES
  ('project-chat', 'Chat', 'conversation project', 'active', 'workspace', '/repos/chat', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
  ('project-empty', 'Empty', 'project without agents', 'active', 'workspace', '/repos/empty', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
INSERT INTO worklines (id, project_id, title, status, role, branch, is_root, created_at, updated_at) VALUES
  ('workline-chat', 'project-chat', 'main', 'active', 'root', 'main', 1, '2026-01-01T00:00:00Z', '2026-01-03T01:00:00Z'),
  ('workline-empty', 'project-empty', 'main', 'active', 'root', 'main', 1, '2026-01-01T00:00:00Z', '2026-01-02T01:00:00Z');
INSERT INTO agents (id, workline_id, type, title, model, system_prompt, permission_mode, status, cwd, message_count, last_message_at, context_summary, error_message, created_at, updated_at) VALUES
  ('agent-chat', 'workline-chat', 'primary', 'Chat agent', 'model-safe', 'SYSTEM_PROMPT_SECRET', 'acceptEdits', 'idle', '/repos/chat', 7, '2026-02-01T00:00:00Z', 'CONTEXT_SUMMARY_SECRET', 'ERROR_MESSAGE_SECRET', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z');`)
	if err != nil {
		t.Fatal(err)
	}

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/navigation", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	body := recorder.Body.String()
	for _, forbidden := range []string{"systemPrompt", "contextSummary", "errorMessage", "SYSTEM_PROMPT_SECRET", "CONTEXT_SUMMARY_SECRET", "ERROR_MESSAGE_SECRET"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("navigation response leaked %q: %s", forbidden, body)
		}
	}

	var response struct {
		Projects      []db.Project                 `json:"projects"`
		Conversations []map[string]json.RawMessage `json:"conversations"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Projects) != 2 {
		t.Fatalf("expected projects to include the empty project, got %+v", response.Projects)
	}
	seenEmpty := false
	for _, project := range response.Projects {
		if project.ID == "project-empty" {
			seenEmpty = true
		}
	}
	if !seenEmpty {
		t.Fatalf("empty project missing from projects: %+v", response.Projects)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected only the project with an agent in conversations, got %+v", response.Conversations)
	}
	conversation := response.Conversations[0]
	allowedKeys := map[string]bool{
		"projectId": true, "projectName": true, "projectPath": true, "projectUpdatedAt": true,
		"worklineId": true, "worklineTitle": true, "worklineRole": true, "worklineBranch": true, "worklineUpdatedAt": true,
		"agentId": true, "agentTitle": true, "agentType": true, "agentStatus": true, "model": true, "permissionMode": true,
		"cwd": true, "messageCount": true, "lastActivityAt": true,
	}
	if len(conversation) != len(allowedKeys) {
		t.Fatalf("unexpected navigation conversation fields: %+v", conversation)
	}
	for key := range conversation {
		if !allowedKeys[key] {
			t.Fatalf("unsafe or unexpected navigation conversation field %q", key)
		}
	}
	if string(conversation["agentId"]) != `"agent-chat"` || string(conversation["lastActivityAt"]) != `"2026-02-01T00:00:00Z"` {
		t.Fatalf("unexpected conversation payload: %+v", conversation)
	}
}

func TestNavigationUsesLocalRequestGuard(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/navigation", nil)
	request.Host = "localhost:7788"
	request.Header.Set("Origin", "http://evil.test")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected navigation route to remain behind local request guard, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
