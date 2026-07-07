package providers

import (
	"encoding/json"
	"strings"
	"testing"
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
