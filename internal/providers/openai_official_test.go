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

func TestOpenAIOfficialStreamsTextAndUsage(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("expected bearer auth header, got %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: response.output_text.delta`,
			`data: {"type":"response.output_text.delta","item_id":"item_1","output_index":0,"content_index":0,"delta":"hel","logprobs":[],"sequence_number":1}`,
			``,
			`event: response.output_text.delta`,
			`data: {"type":"response.output_text.delta","item_id":"item_1","output_index":0,"content_index":0,"delta":"lo","logprobs":[],"sequence_number":2}`,
			``,
			`event: response.output_text.done`,
			`data: {"type":"response.output_text.done","item_id":"item_1","output_index":0,"content_index":0,"text":"hello","logprobs":[],"sequence_number":3}`,
			``,
			`event: response.completed`,
			`data: {"type":"response.completed","sequence_number":4,"response":{"id":"resp_1","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","error":null,"incomplete_details":null,"output":[],"usage":{"input_tokens":12,"output_tokens":4,"input_tokens_details":{"cached_tokens":3},"output_tokens_details":{"reasoning_tokens":1},"total_tokens":16}}}`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAIOfficial(config.ProviderConfig{BaseURL: server.URL, APIKey: "test-key", Model: "gpt-4.1-mini"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{SystemPrompt: "Be concise.", Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var usage Usage
	var done bool
	for event := range events {
		switch event.Type {
		case "error":
			t.Fatalf("unexpected error event: %s", event.Text)
		case "text":
			text += event.Text
		case "usage":
			if event.Usage != nil {
				usage = *event.Usage
			}
		case "done":
			done = true
		}
	}
	if requestBody["stream"] != true {
		t.Fatalf("expected stream=true request, got %+v", requestBody)
	}
	input, _ := requestBody["input"].(string)
	if !strings.Contains(input, "User: hello") || requestBody["instructions"] != "Be concise." {
		t.Fatalf("unexpected request body: %+v", requestBody)
	}
	if text != "hello" {
		t.Fatalf("expected only delta text hello without done duplication, got %q", text)
	}
	if usage.InputTokens != 12 || usage.OutputTokens != 4 || usage.CachedInputTokens != 3 || usage.ReasoningTokens != 1 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if !done {
		t.Fatal("expected done event")
	}
}

func TestOpenAIOfficialStreamsDoneTextWhenNoDelta(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: response.output_text.done`,
			`data: {"type":"response.output_text.done","item_id":"item_1","output_index":0,"content_index":0,"text":"fallback","logprobs":[],"sequence_number":1}`,
			``,
			`event: response.completed`,
			`data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_1","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","error":null,"incomplete_details":null,"output":[],"usage":{"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAIOfficial(config.ProviderConfig{BaseURL: server.URL, APIKey: "test-key", Model: "gpt-4.1-mini"})
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
	if text != "fallback" {
		t.Fatalf("expected done text fallback when no deltas arrived, got %q", text)
	}
}

func TestOpenAIOfficialEmitsFunctionToolCall(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: response.output_item.done`,
			`data: {"type":"response.output_item.done","output_index":0,"sequence_number":1,"item":{"id":"fc_1","type":"function_call","status":"completed","call_id":"call_1","name":"Read","arguments":"{\"path\":\"README.md\"}"}}`,
			``,
			`event: response.completed`,
			`data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_1","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","error":null,"incomplete_details":null,"output":[{"id":"fc_1","type":"function_call","status":"completed","call_id":"call_1","name":"Read","arguments":"{\"path\":\"README.md\"}"}],"usage":{"input_tokens":5,"output_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0},"total_tokens":7}}}`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAIOfficial(config.ProviderConfig{BaseURL: server.URL, APIKey: "test-key", Model: "gpt-4.1-mini"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{
		Messages: []Message{{Role: "user", Content: "read README"}},
		Tools: []ToolSpec{{
			Name:        "Read",
			Description: "Read a file",
			Schema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"path": map[string]any{"type": "string"}},
				"required":   []any{"path"},
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var calls []ToolCall
	var done bool
	for event := range events {
		switch event.Type {
		case "error":
			t.Fatalf("unexpected error event: %s", event.Text)
		case "tool_call":
			if event.ToolCall != nil {
				calls = append(calls, *event.ToolCall)
			}
		case "done":
			done = true
		}
	}
	if !done {
		t.Fatal("expected done event")
	}
	if len(calls) != 1 {
		t.Fatalf("expected one tool call, got %+v", calls)
	}
	if calls[0].ID != "call_1" || calls[0].Name != "Read" || string(calls[0].Input) != `{"path":"README.md"}` {
		t.Fatalf("unexpected tool call: %+v", calls[0])
	}
	tools, ok := requestBody["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected one tool in request, got %+v", requestBody["tools"])
	}
	tool, _ := tools[0].(map[string]any)
	if tool["type"] != "function" || tool["name"] != "Read" || tool["description"] != "Read a file" {
		t.Fatalf("unexpected tool payload: %+v", tool)
	}
	if _, ok := requestBody["input"].([]any); !ok {
		t.Fatalf("expected structured input list when tools are present, got %+v", requestBody["input"])
	}
}

func TestOpenAIOfficialSerializesToolHistory(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: response.completed`,
			`data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_1","object":"response","created_at":1,"model":"gpt-4.1-mini","status":"completed","error":null,"incomplete_details":null,"output":[],"usage":{"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewOpenAIOfficial(config.ProviderConfig{BaseURL: server.URL, APIKey: "test-key", Model: "gpt-4.1-mini"})
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
	input, ok := requestBody["input"].([]any)
	if !ok || len(input) != 2 {
		t.Fatalf("expected function call and output input items, got %+v", requestBody["input"])
	}
	functionCall, _ := input[0].(map[string]any)
	if functionCall["type"] != "function_call" || functionCall["call_id"] != "call_1" || functionCall["name"] != "Read" || functionCall["arguments"] != `{"path":"README.md"}` {
		t.Fatalf("unexpected function call history item: %+v", functionCall)
	}
	functionOutput, _ := input[1].(map[string]any)
	if functionOutput["type"] != "function_call_output" || functionOutput["call_id"] != "call_1" || functionOutput["output"] != "file contents" {
		t.Fatalf("unexpected function output history item: %+v", functionOutput)
	}
}
