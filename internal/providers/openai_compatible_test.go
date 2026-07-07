package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestOpenAICompatibleSendsImageBlocks(t *testing.T) {
	var requestBody struct {
		Messages []struct {
			Role    string `json:"role"`
			Content []struct {
				Type     string `json:"type"`
				Text     string `json:"text"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			} `json:"content"`
		} `json:"messages"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
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
	events, err := provider.Generate(ctx, GenerateRequest{Messages: []Message{{
		Role: "user",
		Blocks: []ContentBlock{
			{Type: "text", Text: "看这张图"},
			{Type: "image", MIMEType: "image/png", Data: []byte{1, 2, 3}, Filename: "a.png"},
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("unexpected error: %s", event.Text)
		}
	}
	if len(requestBody.Messages) != 1 || len(requestBody.Messages[0].Content) != 2 {
		t.Fatalf("unexpected messages payload: %+v", requestBody.Messages)
	}
	if requestBody.Messages[0].Content[0].Type != "text" || requestBody.Messages[0].Content[0].Text != "看这张图" {
		t.Fatalf("expected text block, got %+v", requestBody.Messages[0].Content[0])
	}
	imageURL := requestBody.Messages[0].Content[1].ImageURL.URL
	if requestBody.Messages[0].Content[1].Type != "image_url" || !strings.HasPrefix(imageURL, "data:image/png;base64,") {
		t.Fatalf("expected image_url data URL, got %+v", requestBody.Messages[0].Content[1])
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
			"usage": map[string]any{
				"prompt_tokens":             12,
				"completion_tokens":         4,
				"prompt_tokens_details":     map[string]any{"cached_tokens": 3},
				"completion_tokens_details": map[string]any{"reasoning_tokens": 1},
			},
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
	var usage Usage
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("unexpected error event: %s", event.Text)
		}
		if event.Type == "usage" && event.Usage != nil {
			usage = *event.Usage
		}
		if event.Type == "text" {
			text += event.Text
		}
	}
	if text != "ok" {
		t.Fatalf("expected ok response, got %q", text)
	}
	if usage.InputTokens != 12 || usage.OutputTokens != 4 || usage.CachedInputTokens != 3 || usage.ReasoningTokens != 1 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
}
