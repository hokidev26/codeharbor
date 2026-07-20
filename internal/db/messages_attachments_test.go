package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestAddMessageRoundTripsTurnUsage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	usage := &MessageTurnUsage{InputTokens: 12, OutputTokens: 40, CachedInputTokens: 3, ReasoningTokens: 2, TTFTMS: 250, DurationMS: 2250, TokensPerSecond: 20}
	message, err := store.AddMessage(ctx, Message{AgentID: agent.ID, Role: "assistant", ContentText: "hello", TurnUsage: usage})
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.ListMessagesPage(ctx, agent.ID, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 1 || page.Messages[0].ID != message.ID || page.Messages[0].TurnUsage == nil || *page.Messages[0].TurnUsage != *usage {
		t.Fatalf("unexpected turn usage round trip: %+v", page.Messages)
	}
}

func TestAddMessageRoundTripsToolContentJSON(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`[{"type":"tool_result","toolUseId":"tool-1","toolName":"Read","output":"ok","isError":true}]`)
	message, err := store.AddMessage(ctx, Message{AgentID: agent.ID, Role: "user", ContentText: "tool result", ContentJSON: raw, ParentToolID: "tool-1"})
	if err != nil {
		t.Fatal(err)
	}
	messages, err := store.ListMessages(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].ID != message.ID || string(messages[0].ContentJSON) != string(raw) || messages[0].ParentToolID != "tool-1" {
		t.Fatalf("unexpected round-trip message: %+v", messages)
	}
}

func TestListMessagesPageUsesStableBackwardCursor(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	for index, id := range []string{"message-a", "message-b", "message-c", "message-d", "message-e"} {
		if _, err := store.AddMessage(ctx, Message{
			ID:          id,
			AgentID:     agent.ID,
			Role:        "user",
			ContentText: id,
			CreatedAt:   fmt.Sprintf("2026-01-01T00:00:%02dZ", index),
		}); err != nil {
			t.Fatal(err)
		}
	}

	latest, err := store.ListMessagesPage(ctx, agent.ID, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if !latest.HasMoreBefore || latest.NextBefore == "" || len(latest.Messages) != 2 || latest.Messages[0].ID != "message-d" || latest.Messages[1].ID != "message-e" {
		t.Fatalf("unexpected latest page: %+v", latest)
	}
	older, err := store.ListMessagesPage(ctx, agent.ID, latest.NextBefore, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !older.HasMoreBefore || older.NextBefore == "" || len(older.Messages) != 2 || older.Messages[0].ID != "message-b" || older.Messages[1].ID != "message-c" {
		t.Fatalf("unexpected older page: %+v", older)
	}
	oldest, err := store.ListMessagesPage(ctx, agent.ID, older.NextBefore, 2)
	if err != nil {
		t.Fatal(err)
	}
	if oldest.HasMoreBefore || oldest.NextBefore != "" || len(oldest.Messages) != 1 || oldest.Messages[0].ID != "message-a" {
		t.Fatalf("unexpected oldest page: %+v", oldest)
	}
	if _, err := store.ListMessagesPage(ctx, agent.ID, "not-a-cursor", 2); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("expected invalid cursor error, got %v", err)
	}
}

func TestMigrationV16AddsInternalProviderStateColumn(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `ALTER TABLE agent_messages DROP COLUMN provider_state_json`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 15`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if !testColumnExists(t, ctx, store.DB(), "agent_messages", "provider_state_json") {
		t.Fatal("expected v16 migration to add provider_state_json")
	}
}

func TestMessageProviderStateAndReasoningEffortRemainInternal(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "gemini:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"tool-1":{"thought_signature":"secret-signature"}}`)
	if _, err := store.AddMessage(ctx, Message{AgentID: agent.ID, Role: "assistant", ContentText: "tool call", ProviderStateJSON: state}); err != nil {
		t.Fatal(err)
	}
	messages, err := store.ListMessages(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || string(messages[0].ProviderStateJSON) != string(state) {
		t.Fatalf("provider state did not round-trip: %+v", messages)
	}
	encoded, err := json.Marshal(messages[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-signature") || strings.Contains(string(encoded), "providerState") {
		t.Fatalf("provider state leaked through public JSON: %s", encoded)
	}
	updated, err := store.UpdateAgentReasoningEffort(ctx, agent.ID, "high")
	if err != nil {
		t.Fatal(err)
	}
	if updated.ReasoningEffort != "high" {
		t.Fatalf("reasoning effort did not round-trip: %+v", updated)
	}
}
