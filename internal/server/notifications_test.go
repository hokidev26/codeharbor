package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
)

func TestNotificationSettingsAPIAndTestWebhook(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	received := make(chan webhookPayload, 1)
	webhook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if got := r.Header.Get("User-Agent"); got != "Autoto-Webhook/1.0" {
			t.Fatalf("unexpected webhook user agent %q", got)
		}
		var payload webhookPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode webhook payload: %v", err)
		}
		received <- payload
		w.WriteHeader(http.StatusNoContent)
	}))
	defer webhook.Close()

	app := New(config.Config{}, store, nil, nil)
	app.SetWebhookNotifier(NewWebhookNotifier(store))
	routes := app.Routes()

	putJSON(t, routes, http.MethodPut, "/api/notifications/settings", notificationSettingsPayload{Enabled: true, WebhookURL: webhook.URL, NotifyOnApproval: true, NotifyOnDone: true, NotifyOnError: true}, http.StatusOK)

	recorder := httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/notifications/settings", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected settings 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var settings db.NotificationSettings
	if err := json.NewDecoder(recorder.Body).Decode(&settings); err != nil {
		t.Fatal(err)
	}
	if !settings.Enabled || settings.WebhookURL != webhook.URL || !settings.NotifyOnApproval || !settings.NotifyOnDone || !settings.NotifyOnError {
		t.Fatalf("unexpected notification settings: %+v", settings)
	}

	recorder = httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/notifications/test", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected test 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	select {
	case payload := <-received:
		if payload.Kind != "notification.test" || payload.Event != "test" || payload.Meta["source"] != "Autoto" {
			t.Fatalf("unexpected webhook payload: %+v", payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook test payload")
	}
}

func TestNotificationSettingsRejectsInvalidWebhookURL(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{}, store, nil, nil)
	routes := app.Routes()
	putJSON(t, routes, http.MethodPut, "/api/notifications/settings", notificationSettingsPayload{Enabled: true, WebhookURL: "file:///tmp/hook", NotifyOnApproval: true}, http.StatusBadRequest)
}

func TestWebhookNotifierSendsRunNotification(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	received := make(chan webhookPayload, 1)
	webhook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload webhookPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode webhook payload: %v", err)
		}
		received <- payload
		w.WriteHeader(http.StatusOK)
	}))
	defer webhook.Close()

	_, _, agent, err := store.CreateProject(ctx, "Notify", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, db.Run{AgentID: agent.ID, Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, RunID: run.ID, Role: "assistant", ContentText: "done"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateNotificationSettings(ctx, db.NotificationSettings{Enabled: true, WebhookURL: webhook.URL, NotifyOnApproval: true, NotifyOnDone: true, NotifyOnError: true}); err != nil {
		t.Fatal(err)
	}

	notifier := NewWebhookNotifier(store)
	notifier.Notify(ctx, agentpkg.NotificationEvent{Event: "completed", RunID: run.ID, AgentID: agent.ID, Status: "completed"})
	select {
	case payload := <-received:
		if payload.Kind != "run.completed" || payload.RunID != run.ID || payload.Summary == nil || payload.Summary.MessageCount != 1 {
			t.Fatalf("unexpected run notification payload: %+v", payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for run notification payload")
	}
}

func putJSON(t *testing.T, handler http.Handler, method, path string, payload any, wantStatus int) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, stringsReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != wantStatus {
		t.Fatalf("%s %s expected %d, got %d: %s", method, path, wantStatus, recorder.Code, recorder.Body.String())
	}
}

func stringsReader(data []byte) *bytes.Reader { return bytes.NewReader(data) }
