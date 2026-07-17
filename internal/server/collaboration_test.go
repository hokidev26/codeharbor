package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
)

func TestAuthSessionCookieAndMe(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{"handle":"Alice","password":"correct horse battery staple"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected registration 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one session cookie, got %+v", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != authSessionCookieName || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Value == "" {
		t.Fatalf("expected HttpOnly SameSite session cookie, got %+v", cookie)
	}
	var storedHash string
	if err := store.DB().QueryRowContext(ctx, `SELECT token_hash FROM auth_sessions LIMIT 1`).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash == cookie.Value || storedHash != db.HashSessionToken(cookie.Value) {
		t.Fatal("session token must only be persisted as a hash")
	}

	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(cookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"handle":"Alice"`) {
		t.Fatalf("expected authenticated me response, got %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodGet, "/api/users?handlePrefix=al&limit=3", nil)
	request.AddCookie(cookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"handle":"Alice"`) {
		t.Fatalf("expected authenticated handle suggestions, got %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, newTestRequest(http.MethodGet, "/api/users", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated suggestions to be rejected, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodPost, "/api/auth/logout", nil)
	request.AddCookie(cookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("expected logout to revoke and clear cookie, got %d: %s", recorder.Code, recorder.Header().Get("Set-Cookie"))
	}
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(cookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected revoked session to be unauthorized, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestAuthSessionCookieUsesTrustedProxyHTTPS(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "proxy-session.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, nil, nil)
	registerCollaborationTestUser(t, app, "proxy-user")
	user, _, err := store.GetUserByHandle(ctx, "proxy-user")
	if err != nil {
		t.Fatal(err)
	}

	request := newTestRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "127.0.0.1:4321"
	request.Header.Set("CF-Connecting-IP", "203.0.113.61")
	request.Header.Set("X-Forwarded-Proto", "https")
	recorder := httptest.NewRecorder()
	if err := app.startSession(recorder, request, user); err != nil {
		t.Fatal(err)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != authSessionCookieName || !cookies[0].Secure {
		t.Fatalf("trusted proxy HTTPS must issue a Secure auth cookie, got %+v", cookies)
	}

	cleared := httptest.NewRecorder()
	app.clearSessionCookie(cleared, request)
	clearCookies := cleared.Result().Cookies()
	if len(clearCookies) != 1 || !clearCookies[0].Secure || clearCookies[0].MaxAge >= 0 {
		t.Fatalf("trusted proxy HTTPS must clear the Secure auth cookie consistently, got %+v", clearCookies)
	}
}

func TestMessageDraftsAreIsolatedByUserAndUseCAS(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, nil, nil)
	first := registerCollaborationTestUser(t, app, "first")
	second := registerCollaborationTestUser(t, app, "second")
	secondUser, _, err := store.GetUserByHandle(ctx, "second")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateProjectMember(ctx, db.ProjectMember{ProjectID: project.ID, UserID: secondUser.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}

	putDraft := func(cookie *http.Cookie, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := newTestRequest(http.MethodPut, "/api/agents/"+agent.ID+"/draft", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		app.Routes().ServeHTTP(recorder, request)
		return recorder
	}
	if recorder := putDraft(first, `{"contentText":"first draft","version":0}`); recorder.Code != http.StatusOK {
		t.Fatalf("expected first draft creation, got %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/agents/"+agent.ID+"/draft", nil)
	request.AddCookie(second)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected second user isolation, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder := putDraft(second, `{"contentText":"second draft","version":0}`); recorder.Code != http.StatusOK {
		t.Fatalf("expected second draft creation, got %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodGet, "/api/agents/"+agent.ID+"/draft", nil)
	request.AddCookie(first)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "first draft") || strings.Contains(recorder.Body.String(), "second draft") {
		t.Fatalf("expected first user's own draft, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder := putDraft(first, `{"contentText":"stale","version":0}`); recorder.Code != http.StatusConflict {
		t.Fatalf("expected CAS conflict, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestAuthenticatedMessageOverridesClientCreatedBy(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	registry := providers.NewRegistry()
	registry.Register(attachmentTestProvider{})
	hub := agentpkg.NewHub()
	runner := agentpkg.NewRunner(store, registry, nil, hub, config.AgentConfig{})
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, runner, hub, registry)
	cookie := registerCollaborationTestUser(t, app, "poster")

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/agents/"+agent.ID+"/messages", strings.NewReader(`{"text":"hello","createdBy":"spoofed"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected message 202, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var message db.Message
	if err := json.NewDecoder(recorder.Body).Decode(&message); err != nil {
		t.Fatal(err)
	}
	var createdBy string
	if err := store.DB().QueryRowContext(ctx, `SELECT COALESCE(created_by, '') FROM agent_messages WHERE id = ?`, message.ID).Scan(&createdBy); err != nil {
		t.Fatal(err)
	}
	if createdBy == "" || createdBy == "spoofed" || createdBy != message.CreatedBy {
		t.Fatalf("expected session user to replace client createdBy, message=%+v stored=%q", message, createdBy)
	}
	waitForAgentIdle(t, store, agent.ID)
}

func TestCorrectionCopiesAndAddsAttachmentsAndRejectsCrossMessageAttachment(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.AddMessageWithAttachments(ctx, db.Message{AgentID: agent.ID, Role: "user", ContentText: "original"}, []db.Attachment{{Filename: "kept.txt", MIMEType: "text/plain", Kind: "text", SizeBytes: 4, Data: []byte("keep"), ExtractedText: "keep"}})
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.AddMessageWithAttachments(ctx, db.Message{AgentID: agent.ID, Role: "user", ContentText: "other"}, []db.Attachment{{Filename: "other.txt", MIMEType: "text/plain", Kind: "text", SizeBytes: 5, Data: []byte("other")}})
	if err != nil {
		t.Fatal(err)
	}
	registry := providers.NewRegistry()
	registry.Register(attachmentTestProvider{})
	hub := agentpkg.NewHub()
	runner := agentpkg.NewRunner(store, registry, nil, hub, config.AgentConfig{})
	app := New(config.Config{}, store, runner, hub, registry)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("text", "corrected"); err != nil {
		t.Fatal(err)
	}
	keepJSON, _ := json.Marshal([]string{source.Attachments[0].ID})
	if err := writer.WriteField("keepAttachmentIds", string(keepJSON)); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("files", "new.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("new")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/agents/"+agent.ID+"/messages/"+source.ID+"/corrections", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected correction 202, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var correction db.Message
	if err := json.NewDecoder(recorder.Body).Decode(&correction); err != nil {
		t.Fatal(err)
	}
	if correction.CorrectionOfMessageID != source.ID || correction.RunID == "" || len(correction.Attachments) != 2 {
		t.Fatalf("unexpected correction response: %+v", correction)
	}
	all, err := store.ListMessagesWithAttachmentData(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	var stored db.Message
	for _, message := range all {
		if message.ID == correction.ID {
			stored = message
		}
	}
	if stored.ID == "" || stored.ContentText != "corrected" || len(stored.Attachments) != 2 || string(stored.Attachments[0].Data) != "keep" || string(stored.Attachments[1].Data) != "new" {
		t.Fatalf("expected copied and new attachment data, got %+v", stored)
	}
	if source.ContentText != "original" || len(source.Attachments) != 1 {
		t.Fatalf("source message was unexpectedly changed: %+v", source)
	}

	payload, _ := json.Marshal(correctionRequest{KeepAttachmentIDs: []string{other.Attachments[0].ID}})
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodPost, "/api/agents/"+agent.ID+"/messages/"+source.ID+"/corrections", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected cross-message attachment rejection, got %d: %s", recorder.Code, recorder.Body.String())
	}
	waitForAgentIdle(t, store, agent.ID)
}

func TestProjectScopedRoutesRequireMembership(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, workline, agent, err := store.CreateProject(ctx, "Private", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Auth: config.AuthConfig{RegistrationOpen: true}}, store, nil, agentpkg.NewHub())
	owner := registerCollaborationTestUser(t, app, "owner")
	outsider := registerCollaborationTestUser(t, app, "outsider")

	cases := []string{
		"/api/projects/" + project.ID,
		"/api/projects/" + project.ID + "/worklines",
		"/api/worklines/" + workline.ID,
		"/api/worklines/" + workline.ID + "/agents",
		"/api/agents/" + agent.ID,
		"/api/agents/" + agent.ID + "/messages",
		"/api/v2/agents/" + agent.ID + "/live-snapshot",
	}
	for _, path := range cases {
		recorder := httptest.NewRecorder()
		request := newTestRequest(http.MethodGet, path, nil)
		request.AddCookie(owner)
		app.Routes().ServeHTTP(recorder, request)
		if recorder.Code == http.StatusUnauthorized || recorder.Code == http.StatusNotFound {
			t.Errorf("owner unexpectedly denied %s: %d %s", path, recorder.Code, recorder.Body.String())
		}

		recorder = httptest.NewRecorder()
		request = newTestRequest(http.MethodGet, path, nil)
		request.AddCookie(outsider)
		app.Routes().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNotFound {
			t.Errorf("expected outsider to receive 404 for %s, got %d: %s", path, recorder.Code, recorder.Body.String())
		}
	}

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/agents/"+agent.ID, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated project route to require login, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestMessageListRouteUsesCursorPagination(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Paged", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 5; index++ {
		if _, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, Role: "user", ContentText: fmt.Sprintf("message-%d", index), CreatedAt: fmt.Sprintf("2026-01-01T00:00:0%dZ", index)}); err != nil {
			t.Fatal(err)
		}
	}
	app := New(config.Config{}, store, nil, agentpkg.NewHub())

	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, newTestRequest(http.MethodGet, "/api/agents/"+agent.ID+"/messages?limit=2", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected first page 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var first db.MessagePage
	if err := json.NewDecoder(recorder.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}
	if len(first.Messages) != 2 || !first.HasMoreBefore || first.NextBefore == "" || first.Messages[0].ContentText != "message-3" || first.Messages[1].ContentText != "message-4" {
		t.Fatalf("unexpected first page: %+v", first)
	}

	recorder = httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, newTestRequest(http.MethodGet, "/api/agents/"+agent.ID+"/messages?limit=2&before="+first.NextBefore, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected second page 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var second db.MessagePage
	if err := json.NewDecoder(recorder.Body).Decode(&second); err != nil {
		t.Fatal(err)
	}
	if len(second.Messages) != 2 || second.Messages[0].ContentText != "message-1" || second.Messages[1].ContentText != "message-2" {
		t.Fatalf("unexpected second page: %+v", second)
	}

	for _, query := range []string{"?limit=201", "?before=invalid"} {
		recorder = httptest.NewRecorder()
		app.Routes().ServeHTTP(recorder, newTestRequest(http.MethodGet, "/api/agents/"+agent.ID+"/messages"+query, nil))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("expected bad pagination query %q to return 400, got %d: %s", query, recorder.Code, recorder.Body.String())
		}
	}
}

func registerCollaborationTestUser(t *testing.T, app *Server, handle string) *http.Cookie {
	t.Helper()
	body := `{"handle":"` + handle + `","password":"correct horse battery staple"}`
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("register %s: status=%d body=%s", handle, recorder.Code, recorder.Body.String())
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("register %s did not return one cookie: %+v", handle, cookies)
	}
	return cookies[0]
}
