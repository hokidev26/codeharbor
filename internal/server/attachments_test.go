package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
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
	_, _, agent, err := store.CreateProject(context.Background(), "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
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
	if err := writer.WriteField("text", "请读取附件"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("createdBy", "spoofed"); err != nil {
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
	request := newTestRequest(http.MethodPost, "/api/agents/"+agent.ID+"/messages", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var posted db.Message
	if err := json.NewDecoder(recorder.Body).Decode(&posted); err != nil {
		t.Fatal(err)
	}
	if posted.CreatedBy != "" {
		t.Fatalf("expected unauthenticated multipart createdBy to be ignored, got %q", posted.CreatedBy)
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
	messagesWithData, err := store.ListMessagesWithAttachmentData(context.Background(), agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messagesWithData) == 0 || len(messagesWithData[0].Attachments) != 1 || messagesWithData[0].Attachments[0].ExtractedText != "hello attachment" {
		t.Fatalf("expected extracted text to be available for agent, got %+v", messagesWithData)
	}

	recorder = httptest.NewRecorder()
	path := "/api/agents/" + agent.ID + "/messages/" + posted.ID + "/attachments/" + posted.Attachments[0].ID
	request = newTestRequest(http.MethodGet, path, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected attachment 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "hello attachment" {
		t.Fatalf("unexpected attachment body: %q", recorder.Body.String())
	}
	if disposition := recorder.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "attachment") {
		t.Fatalf("expected downloads by default, got %q", disposition)
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("expected nosniff on attachment response, got %q", recorder.Header().Get("X-Content-Type-Options"))
	}
	waitForAgentIdle(t, store, agent.ID)
}

func TestAttachmentUsesContentTypeOverClaimedImageAndSanitizesFilename(t *testing.T) {
	data := []byte("<html><body>not an image</body></html>")
	mimeType := normalizeAttachmentMIME("photo.png", "image/png", data)
	if mimeType != "text/html" {
		t.Fatalf("expected detected HTML MIME, got %q", mimeType)
	}
	if kind := classifyAttachment("photo.png", mimeType, data); kind != "text" {
		t.Fatalf("expected fake image to avoid image classification, got %q", kind)
	}
	var imageData bytes.Buffer
	pngImage := image.NewRGBA(image.Rect(0, 0, 1, 1))
	pngImage.Set(0, 0, color.Black)
	if err := png.Encode(&imageData, pngImage); err != nil {
		t.Fatal(err)
	}
	imageMIME := normalizeAttachmentMIME("photo.png", "application/octet-stream", imageData.Bytes())
	if imageMIME != "image/png" || classifyAttachment("photo.png", imageMIME, imageData.Bytes()) != "image" {
		t.Fatalf("expected a decoded PNG to be the only image kind, MIME=%q", imageMIME)
	}
	filename := sanitizeAttachmentFilename("../../report\x00\r\n.txt")
	if filename != "report---.txt" || strings.ContainsAny(filename, "/\\\r\n\x00") {
		t.Fatalf("expected traversal/control-safe filename, got %q", filename)
	}
	if got := sanitizeAttachmentFilename("../.."); got != "attachment" {
		t.Fatalf("expected traversal-only filename fallback, got %q", got)
	}
}

func TestExtractDOCXTextRejectsHighCompressionArchive(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, err := writer.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(strings.Repeat("A", int(maxDOCXDocumentBytes)+1))); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extractDOCXText(buffer.Bytes()); err == nil || !strings.Contains(err.Error(), "decompression budget") {
		t.Fatalf("expected DOCX decompression budget rejection, got %v", err)
	}
}

func TestPostMessageMapsUnavailableServerSkillToConflict(t *testing.T) {
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
	if _, err := store.CreateSkill(ctx, db.Skill{Name: "Disabled", Command: "/disabled", Description: "disabled", Prompt: "Trusted prompt.", Source: "manual", Enabled: false}); err != nil {
		t.Fatal(err)
	}
	registry := providers.NewRegistry()
	registry.Register(attachmentTestProvider{})
	hub := agentpkg.NewHub()
	runner := agentpkg.NewRunner(store, registry, nil, hub, config.AgentConfig{})
	app := New(config.Config{}, store, runner, hub, registry)

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/agents/"+agent.ID+"/messages", strings.NewReader(`{"text":"/disabled client prompt"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
	messages, err := store.ListMessages(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 0 {
		t.Fatalf("rejected skill invocation must not persist a message: %+v", messages)
	}
}

func waitForAgentIdle(t *testing.T, store *db.Store, agentID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		agent, err := store.GetAgent(context.Background(), agentID)
		if err != nil {
			t.Fatal(err)
		}
		if agent.Status == "idle" || agent.Status == "error" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for agent to finish")
}
