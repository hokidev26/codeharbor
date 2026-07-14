package providers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"

	"autoto/internal/config"
)

func TestAnthropicMessagesPreserveToolBlocks(t *testing.T) {
	messages, _ := anthropicMessages([]Message{
		{Role: "assistant", Blocks: []ContentBlock{{Type: "text", Text: "checking"}, {Type: "tool_use", ToolUseID: "tool-1", ToolName: "Read", Input: json.RawMessage(`{"file_path":"README.md"}`)}}},
		{Role: "user", Blocks: []ContentBlock{{Type: "tool_result", ToolUseID: "tool-1", ToolName: "Read", Output: "ok", IsError: true}}},
	}, "")
	data, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{"tool_use", "tool_result", "tool-1", "Read", "is_error"} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected marshaled Anthropic messages to contain %q: %s", want, text)
		}
	}
}

func TestAnthropicMessagesPreserveImageBlocks(t *testing.T) {
	messages, _ := anthropicMessages([]Message{{Role: "user", Blocks: []ContentBlock{{Type: "text", Text: "see image"}, {Type: "image", MIMEType: "image/png", Data: []byte{1, 2, 3}, Filename: "a.png"}}}}, "")
	data, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{"image", "base64", "image/png", "AQID"} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected marshaled Anthropic image message to contain %q: %s", want, text)
		}
	}
}

func TestAnthropicProviderStreamsTextUsageAndToolCalls(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("X-Api-Key"); got != "test-key" {
			t.Fatalf("expected Anthropic API key header, got %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: message_start`,
			`data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"cache_read_input_tokens":2,"output_tokens":0,"output_tokens_details":{"thinking_tokens":0}}}}`,
			``,
			`event: content_block_start`,
			`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			``,
			`event: content_block_delta`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hel"}}`,
			``,
			`event: content_block_delta`,
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}`,
			``,
			`event: content_block_stop`,
			`data: {"type":"content_block_stop","index":0}`,
			``,
			`event: content_block_start`,
			`data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}`,
			``,
			`event: content_block_delta`,
			`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":"}}`,
			``,
			`event: content_block_delta`,
			`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"README.md\"}"}}`,
			``,
			`event: content_block_stop`,
			`data: {"type":"content_block_stop","index":1}`,
			``,
			`event: message_delta`,
			`data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":10,"cache_read_input_tokens":2,"output_tokens":7,"output_tokens_details":{"thinking_tokens":1}}}`,
			``,
			`event: message_stop`,
			`data: {"type":"message_stop"}`,
			``,
		}, "\n") + "\n\n"))
	}))
	defer server.Close()

	provider := NewAnthropicProvider(config.ProviderConfig{BaseURL: server.URL, APIKey: "test-key", Model: "claude-sonnet-4-5", MaxTokens: 128})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}, Tools: []ToolSpec{{Name: "Read", Description: "Read a file", Schema: map[string]any{"type": "object"}}}})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var usage Usage
	var toolCalls []ToolCall
	var stopReason string
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
		case "tool_call":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			stopReason = event.StopReason
		}
	}
	if requestBody["stream"] != true {
		t.Fatalf("expected stream=true request, got %+v", requestBody)
	}
	if text != "hello" {
		t.Fatalf("expected streamed text hello, got %q", text)
	}
	if usage.InputTokens != 10 || usage.OutputTokens != 7 || usage.CachedInputTokens != 2 || usage.ReasoningTokens != 1 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if len(toolCalls) != 1 || toolCalls[0].ID != "toolu_1" || toolCalls[0].Name != "Read" || string(toolCalls[0].Input) != `{"file_path":"README.md"}` {
		t.Fatalf("unexpected tool calls: %+v", toolCalls)
	}
	if stopReason != "tool_use" {
		t.Fatalf("expected tool_use stop reason, got %q", stopReason)
	}
}

func TestAnthropicProviderWithoutAPIKeyReturnsUnavailableError(t *testing.T) {
	provider := NewAnthropicProvider(config.ProviderConfig{Model: "claude-sonnet-4-5"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}})
	if err == nil || !errors.Is(err, ErrProviderUnavailable) || !strings.Contains(strings.ToLower(err.Error()), "unavailable") {
		t.Fatalf("expected explicit unavailable error, events=%v err=%v", events, err)
	}
	if events != nil {
		t.Fatal("unconfigured provider must not return a successful event stream")
	}
}

func TestAnthropicPromptCachingMarksLargeRequests(t *testing.T) {
	messages, system := anthropicMessages([]Message{{Role: "user", Content: strings.Repeat("please inspect the repository context. ", 120)}}, strings.Repeat("stable coding agent instructions. ", 120))
	params := anthropic.MessageNewParams{
		MaxTokens: 128,
		Model:     anthropic.Model("claude-sonnet-4-5"),
		Messages:  messages,
		System:    system,
		Tools: anthropicTools([]ToolSpec{{
			Name:        "Read",
			Description: strings.Repeat("Read a file from the bounded workspace. ", 30),
			Schema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"file_path": map[string]any{"type": "string"}},
				"required":   []string{"file_path"},
			},
		}}),
	}
	if anthropicPromptCacheFootprint(params) < anthropicPromptCacheMinBytes {
		t.Fatalf("test request should be large enough for prompt caching")
	}
	applyAnthropicPromptCaching(&params)
	data, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if count := strings.Count(text, `"cache_control"`); count < 3 {
		t.Fatalf("expected system, tool, and message cache controls, got %d in %s", count, text)
	}
	for _, want := range []string{`"ttl":"5m"`, `"type":"ephemeral"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected %s in cached request: %s", want, text)
		}
	}
}

func TestAnthropicPromptCachingSkipsSmallRequests(t *testing.T) {
	messages, system := anthropicMessages([]Message{{Role: "user", Content: "hello"}}, "short system")
	params := anthropic.MessageNewParams{MaxTokens: 128, Model: anthropic.Model("claude-sonnet-4-5"), Messages: messages, System: system}
	applyAnthropicPromptCaching(&params)
	data, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"cache_control"`) {
		t.Fatalf("small request should not include cache_control: %s", string(data))
	}
}

func TestAnthropicToolsMarshalSchemaAndDescription(t *testing.T) {
	tools := anthropicTools([]ToolSpec{{
		Name:        "Read",
		Description: "Read a file",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"file_path": map[string]any{"type": "string"},
			},
			"required": []string{"file_path"},
		},
	}})
	if len(tools) != 1 {
		t.Fatalf("expected one tool, got %d", len(tools))
	}
	data, err := json.Marshal(tools)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{"Read", "Read a file", "input_schema", "file_path", "required"} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected marshaled Anthropic tools to contain %q: %s", want, text)
		}
	}
}
