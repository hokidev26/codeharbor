package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"codeharbor/internal/config"
)

func TestOpenAICompatibleListModelsAllowsOptionalAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("expected no authorization header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"id": "gpt-a"}, {"id": "gpt-b"}},
		})
	}))
	defer server.Close()

	provider := NewOpenAICompatible(config.ProviderConfig{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		BaseURL:        server.URL,
		Model:          "gpt-5.5",
		APIKeyOptional: true,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	models, err := provider.ListModels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gpt-a" || models[1] != "gpt-b" {
		t.Fatalf("unexpected models: %+v", models)
	}
}

func TestOpenAICompatibleAllowsOptionalAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("expected no authorization header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{
				"message": map[string]string{"content": "ok"},
			}},
		})
	}))
	defer server.Close()

	provider := NewOpenAICompatible(config.ProviderConfig{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		BaseURL:        server.URL,
		Model:          "gpt-5.5",
		APIKeyOptional: true,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	events, err := provider.Generate(ctx, GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("unexpected error event: %s", event.Text)
		}
		if event.Type == "text" {
			text += event.Text
		}
	}
	if text != "ok" {
		t.Fatalf("expected ok response, got %q", text)
	}
}
