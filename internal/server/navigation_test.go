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
  ('agent-chat', 'workline-chat', 'primary', 'Chat agent', 'model-safe', 'SYSTEM_PROMPT_SECRET', 'acceptEdits', 'idle', '/repos/chat', 7, '2026-02-01T00:00:00Z', 'CONTEXT_SUMMARY_SECRET', 'ERROR_MESSAGE_SECRET', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z'),
  ('agent-review', 'workline-chat', 'subagent', 'Review agent', 'model-review', 'SYSTEM_PROMPT_SECRET_2', 'readOnly', 'running', '/repos/chat', 3, '2026-01-31T00:00:00Z', 'CONTEXT_SUMMARY_SECRET_2', 'ERROR_MESSAGE_SECRET_2', '2026-01-02T00:00:00Z', '2026-01-31T00:00:00Z');`)
	if err != nil {
		t.Fatal(err)
	}

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/navigation", nil)
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
	if len(response.Conversations) != 2 {
		t.Fatalf("expected both agents from the same project in conversations, got %+v", response.Conversations)
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
	second := response.Conversations[1]
	if string(second["projectId"]) != `"project-chat"` || string(second["agentId"]) != `"agent-review"` || string(second["agentStatus"]) != `"running"` {
		t.Fatalf("expected the second agent to remain grouped under the same project: %+v", second)
	}
}

func TestNavigationRequiresMembershipWhenUsersExist(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "membership.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, nil, nil)
	firstCookie := registerCollaborationTestUser(t, app, "navigation-first")
	registerCollaborationTestUser(t, app, "navigation-second")
	first, _, err := store.GetUserByHandle(ctx, "navigation-first")
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := store.GetUserByHandle(ctx, "navigation-second")
	if err != nil {
		t.Fatal(err)
	}
	firstProject, _, firstAgent, err := store.CreateProjectForUser(ctx, first.ID, "First project", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	secondProject, _, secondAgent, err := store.CreateProjectForUser(ctx, second.ID, "Second project", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}

	unauthenticated := httptest.NewRecorder()
	app.Routes().ServeHTTP(unauthenticated, newTestRequest(http.MethodGet, "/api/navigation", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("expected navigation to require a user session, got %d: %s", unauthenticated.Code, unauthenticated.Body.String())
	}

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/navigation", nil)
	request.AddCookie(firstCookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected member navigation 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, expected := range []string{firstProject.ID, firstAgent.ID} {
		if !strings.Contains(body, expected) {
			t.Fatalf("member navigation omitted %q: %s", expected, body)
		}
	}
	for _, forbidden := range []string{secondProject.ID, secondAgent.ID} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("member navigation leaked %q: %s", forbidden, body)
		}
	}
}

func TestNavigationUsesLocalRequestGuard(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/navigation", nil)
	request.Host = "localhost:7788"
	request.Header.Set("Origin", "http://evil.test")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected navigation route to remain behind local request guard, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
