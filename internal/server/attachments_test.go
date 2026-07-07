package server

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
)

type attachmentTestProvider struct{}

func (attachmentTestProvider) Name() string { return "fake" }
func (attachmentTestProvider) ListModels(context.Context) ([]string, error) {
	return []string{"test"}, nil
}
func (attachmentTestProvider) Generate(context.Context, providers.GenerateRequest) (<-chan providers.Event, error) {
	ch := make(chan providers.Event, 2)
	ch <- providers.Event{Type: "text", Text: "ok"}
	ch <- providers.Event{Type: "done", Done: true}
	close(ch)
	return ch, nil
}

func TestPostMultipartMessagePersistsAttachmentAndServesData(t *testing.T) {
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(context.Background(), "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	registry := providers.NewRegistry()
	registry.Register(attachmentTestProvider{})
	hub := agent.NewHub()
	runner := agent.NewRunner(store, registry, nil, hub, config.AgentConfig{})
	app := New(config.Config{}, store, runner, hub, registry)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("text", "请读取附件"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("files", "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("hello attachment")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/messages", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var posted db.Message
	if err := json.NewDecoder(recorder.Body).Decode(&posted); err != nil {
		t.Fatal(err)
	}
	if len(posted.Attachments) != 1 {
		t.Fatalf("expected one attachment in response, got %+v", posted.Attachments)
	}
	if posted.Attachments[0].Data != nil {
		t.Fatal("expected attachment metadata response to omit raw data")
	}
	if posted.Attachments[0].Kind != "text" || posted.Attachments[0].ExtractedText != "" {
		t.Fatalf("unexpected attachment metadata: %+v", posted.Attachments[0])
	}
	messagesWithData, err := store.ListMessagesWithAttachmentData(context.Background(), narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messagesWithData) == 0 || len(messagesWithData[0].Attachments) != 1 || messagesWithData[0].Attachments[0].ExtractedText != "hello attachment" {
		t.Fatalf("expected extracted text to be available for agent, got %+v", messagesWithData)
	}

	recorder = httptest.NewRecorder()
	path := "/api/narrators/" + narrator.ID + "/messages/" + posted.ID + "/attachments/" + posted.Attachments[0].ID
	request = httptest.NewRequest(http.MethodGet, path, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected attachment 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "hello attachment" {
		t.Fatalf("unexpected attachment body: %q", recorder.Body.String())
	}
	waitForNarratorIdle(t, store, narrator.ID)
}

func waitForNarratorIdle(t *testing.T, store *db.Store, narratorID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		narrator, err := store.GetNarrator(context.Background(), narratorID)
		if err != nil {
			t.Fatal(err)
		}
		if narrator.Status == "idle" || narrator.Status == "error" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for narrator to finish")
}
