package db

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestCreateProjectCreatesCoreRecords(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	project, chapter, narrator, err := store.CreateProject(context.Background(), "Demo", "desc", t.TempDir(), "openai-compatible:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if project.ID == "" || chapter.ID == "" || narrator.ID == "" {
		t.Fatal("expected ids")
	}
	got, err := store.GetNarrator(context.Background(), narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ChapterID != chapter.ID {
		t.Fatalf("expected narrator chapter %s, got %s", chapter.ID, got.ChapterID)
	}
}

func TestUpdateNarratorContextSummaryRoundTrips(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateNarratorContextSummary(ctx, narrator.ID, "summary text", "message-1", 42); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetNarrator(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ContextSummary != "summary text" || got.PruneBoundaryMessageID != "message-1" || got.PrunedPercent != 42 {
		t.Fatalf("unexpected context summary round trip: %+v", got)
	}
}

func TestListProjectsReturnsEmptySlice(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	projects, err := store.ListProjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if projects == nil {
		t.Fatal("expected empty slice, got nil")
	}
	if len(projects) != 0 {
		t.Fatalf("expected no projects, got %d", len(projects))
	}
}

func TestAddAPIRequestPersistsUsage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, Role: "user", ContentText: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"id": "raw"})
	request, err := store.AddAPIRequest(ctx, APIRequest{NarratorID: narrator.ID, MessageID: message.ID, Provider: "openai", Model: "gpt-test", InputTokens: 10, OutputTokens: 4, CachedInputTokens: 2, ReasoningTokens: 1, DurationMS: 123, ErrorMessage: "", RawDumpJSON: raw})
	if err != nil {
		t.Fatal(err)
	}
	if request.ID == "" || request.Kind != "model" || request.CreatedAt == "" {
		t.Fatalf("unexpected request metadata: %+v", request)
	}
	var count, inputTokens, outputTokens int64
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM api_requests WHERE narrator_id = ? AND message_id = ?`, narrator.ID, message.ID).Scan(&count, &inputTokens, &outputTokens); err != nil {
		t.Fatal(err)
	}
	if count != 1 || inputTokens != 10 || outputTokens != 4 {
		t.Fatalf("unexpected stored api request stats: count=%d input=%d output=%d", count, inputTokens, outputTokens)
	}
}

func TestAddMessageRoundTripsToolContentJSON(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`[{"type":"tool_result","toolUseId":"tool-1","toolName":"Read","output":"ok","isError":true}]`)
	message, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, Role: "user", ContentText: "tool result", ContentJSON: raw, ParentToolID: "tool-1"})
	if err != nil {
		t.Fatal(err)
	}
	messages, err := store.ListMessages(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].ID != message.ID || string(messages[0].ContentJSON) != string(raw) || messages[0].ParentToolID != "tool-1" {
		t.Fatalf("unexpected round-trip message: %+v", messages)
	}
}

func TestBackendRegistryActivatesSingleBackend(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	first, err := store.CreateBackend(ctx, Backend{Name: "Local", Kind: "local", BaseURL: "http://127.0.0.1:8000"})
	if err != nil {
		t.Fatal(err)
	}
	if !first.Active {
		t.Fatal("expected first backend to become active")
	}
	second, err := store.CreateBackend(ctx, Backend{Name: "Cloud", Kind: "cloud", BaseURL: "https://example.test", Active: true})
	if err != nil {
		t.Fatal(err)
	}
	if !second.Active {
		t.Fatal("expected requested backend to become active")
	}

	backends, err := store.ListBackends(ctx)
	if err != nil {
		t.Fatal(err)
	}
	activeCount := 0
	for _, backend := range backends {
		if backend.Active {
			activeCount++
			if backend.ID != second.ID {
				t.Fatalf("expected second backend active, got %s", backend.ID)
			}
		}
	}
	if activeCount != 1 {
		t.Fatalf("expected exactly one active backend, got %d", activeCount)
	}
}

func TestMCPServerRegistryRoundTripsConfig(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	created, err := store.CreateMCPServer(ctx, MCPServer{Name: "Fake", Transport: "stdio", Command: "node", Args: []string{"server.js"}, CWD: "/tmp", Env: map[string]string{"TOKEN": "secret"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.GetMCPServer(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Command != "node" || got.Args[0] != "server.js" || got.Env["TOKEN"] != "secret" || !got.Enabled {
		t.Fatalf("unexpected MCP server round trip: %+v", got)
	}

	got.Enabled = false
	got.Args = []string{"other.js"}
	updated, err := store.UpdateMCPServer(ctx, got)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Enabled || updated.Args[0] != "other.js" {
		t.Fatalf("unexpected MCP server update: %+v", updated)
	}

	servers, err := store.ListMCPServers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(servers) != 1 || servers[0].ID != created.ID {
		t.Fatalf("expected one MCP server, got %+v", servers)
	}
	if err := store.DeleteMCPServer(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetMCPServer(ctx, created.ID); !IsNotFound(err) {
		t.Fatalf("expected deleted MCP server to be missing, got %v", err)
	}
}
