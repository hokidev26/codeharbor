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

func TestOpenAICompatibleStreamsTextAndToolCalls(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`data: {"choices":[{"delta":{"content":"hel"}}]}`,
			``,
			`data: {"choices":[{"delta":{"content":"lo"}}]}`,
			``,
			`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{\"path\":\"README"}}]}}]}`,
			``,
			`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":".md\"}"}}]}}]}`,
			``,
			`data: [DONE]`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAICompatible(config.ProviderConfig{Name: "cliproxyapi", Type: "openai-compatible", BaseURL: server.URL, Model: "gpt-5.5", APIKeyOptional: true})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{
		Messages: []Message{{Role: "user", Content: "read README"}},
		Tools:    []ToolSpec{{Name: "Read", Description: "Read a file", Schema: map[string]any{"type": "object", "properties": map[string]any{"path": map[string]any{"type": "string"}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var calls []ToolCall
	for event := range events {
		switch event.Type {
		case "error":
			t.Fatalf("unexpected error event: %s", event.Text)
		case "text":
			text += event.Text
		case "tool_call":
			if event.ToolCall != nil {
				calls = append(calls, *event.ToolCall)
			}
		}
	}
	if text != "hello" {
		t.Fatalf("expected streamed text hello, got %q", text)
	}
	if len(calls) != 1 || calls[0].ID != "call_1" || calls[0].Name != "Read" || string(calls[0].Input) != `{"path":"README.md"}` {
		t.Fatalf("unexpected tool calls: %+v", calls)
	}
	if requestBody["stream"] != true {
		t.Fatalf("expected stream=true, got %+v", requestBody)
	}
	tools, ok := requestBody["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected tools payload, got %+v", requestBody["tools"])
	}
}

func TestOpenAICompatibleSerializesToolHistory(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": "ok"}}}})
	}))
	defer server.Close()

	provider := NewOpenAICompatible(config.ProviderConfig{Name: "cliproxyapi", Type: "openai-compatible", BaseURL: server.URL, Model: "gpt-5.5", APIKeyOptional: true})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{
		Messages: []Message{
			{Role: "assistant", Blocks: []ContentBlock{{Type: "tool_use", ToolUseID: "call_1", ToolName: "Read", Input: json.RawMessage(`{"path":"README.md"}`)}}},
			{Role: "user", Blocks: []ContentBlock{{Type: "tool_result", ToolUseID: "call_1", ToolName: "Read", Output: "file contents"}}},
		},
		Tools: []ToolSpec{{Name: "Read", Schema: map[string]any{"type": "object", "properties": map[string]any{}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("unexpected error event: %s", event.Text)
		}
	}
	messages, ok := requestBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("expected assistant tool call and tool result messages, got %+v", requestBody["messages"])
	}
	assistant, _ := messages[0].(map[string]any)
	if assistant["role"] != "assistant" {
		t.Fatalf("expected assistant tool call message, got %+v", assistant)
	}
	toolCalls, ok := assistant["tool_calls"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("expected one assistant tool call, got %+v", assistant["tool_calls"])
	}
	call, _ := toolCalls[0].(map[string]any)
	function, _ := call["function"].(map[string]any)
	if call["id"] != "call_1" || function["name"] != "Read" || function["arguments"] != `{"path":"README.md"}` {
		t.Fatalf("unexpected assistant tool call payload: %+v", call)
	}
	toolResult, _ := messages[1].(map[string]any)
	if toolResult["role"] != "tool" || toolResult["tool_call_id"] != "call_1" || toolResult["content"] != "file contents" {
		t.Fatalf("unexpected tool result message: %+v", toolResult)
	}
}
