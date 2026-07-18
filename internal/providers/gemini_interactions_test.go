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

	"autoto/internal/config"
)

func TestGeminiInteractionsStreamsNativeFunctionCalls(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/interactions" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "gemini-secret" {
			t.Fatalf("x-goog-api-key = %q", got)
		}
		if got := r.Header.Get("Api-Revision"); got != "2026-05-20" {
			t.Fatalf("Api-Revision = %q", got)
		}
		if got := r.URL.Query().Get("alt"); got != "sse" {
			t.Fatalf("alt = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			"event: response.output_text.delta",
			`data: {"delta":"hello "}`,
			"",
			`data: {"event":"response.output_text.delta","data":{"delta":"world"}}`,
			"",
			"event: response.output_item.done",
			`data: {"type":"function_call","id":"call-1","name":"Read","arguments":{"file_path":"README.md"},"thought_signature":"signature-1"}`,
			"",
			"event: response.completed",
			`data: {"usage":{"prompt_token_count":12,"candidates_token_count":4,"cached_content_token_count":2,"thoughts_token_count":3}}`,
			"",
		}, "\n")))
	}))
	defer server.Close()

	provider := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: server.URL + "/v1beta/interactions", APIKey: "gemini-secret", Model: "gemini-test"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := provider.Generate(ctx, GenerateRequest{
		SystemPrompt:    "Be concise.",
		ReasoningEffort: "high",
		MaxOutputTokens: 64,
		Messages:        []Message{{Role: "user", Blocks: []ContentBlock{{Type: "text", Text: "read the image"}, {Type: "image", MIMEType: "image/png", Data: []byte{1, 2, 3}}}}},
		Tools: []ToolSpec{{Name: "Read", Description: "Read a file", Schema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"properties": map[string]any{
				"file_path": map[string]any{"type": "string", "minimum": 1},
			},
			"required": []any{"file_path", "missing"},
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var calls []ToolCall
	var usage Usage
	var dispatch *DispatchInfo
	var stopReason string
	for event := range events {
		if event.Dispatch != nil {
			dispatch = event.Dispatch
		}
		switch event.Type {
		case "error":
			t.Fatalf("unexpected event error: %s", event.Text)
		case "text":
			text += event.Text
		case "tool_call":
			calls = append(calls, *event.ToolCall)
		case "usage":
			usage = *event.Usage
		case "done":
			stopReason = event.StopReason
		}
	}
	if text != "hello world" {
		t.Fatalf("text = %q", text)
	}
	if len(calls) != 1 || calls[0].ID != "call-1" || calls[0].Name != "Read" || string(calls[0].Input) != `{"file_path":"README.md"}` {
		t.Fatalf("unexpected calls: %+v", calls)
	}
	if geminiThoughtSignature(calls[0].ProviderState) != "signature-1" {
		t.Fatalf("thought signature was not preserved: %s", calls[0].ProviderState)
	}
	if usage != (Usage{InputTokens: 12, OutputTokens: 4, CachedInputTokens: 2, ReasoningTokens: 3}) {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if stopReason != "completed" {
		t.Fatalf("Gemini completion stop reason = %q", stopReason)
	}
	if dispatch == nil || dispatch.Provider != "gemini" || dispatch.Model != "gemini-test" || dispatch.CredentialID != configuredCredentialID {
		t.Fatalf("unexpected dispatch attribution: %+v", dispatch)
	}
	if payload["model"] != "gemini-test" || payload["stream"] != true || payload["store"] != false {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload["system_instruction"] != "Be concise." {
		t.Fatalf("missing system instruction: %+v", payload)
	}
	generationConfig, _ := payload["generation_config"].(map[string]any)
	if generationConfig["thinking_level"] != "high" || generationConfig["max_output_tokens"] != float64(64) {
		t.Fatalf("missing thinking level or max output tokens: %+v", payload)
	}
	tools, _ := payload["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("unexpected tools: %+v", payload["tools"])
	}
	tool := tools[0].(map[string]any)
	schema := tool["parameters"].(map[string]any)
	if _, exists := schema["additionalProperties"]; exists || len(schema["required"].([]any)) != 1 {
		t.Fatalf("schema was not sanitized: %+v", schema)
	}
}

func TestGeminiInteractionsStreamFailsClosedWithoutTerminalEvent(t *testing.T) {
	out := make(chan Event, 4)
	handleGeminiInteractionsSSE(out, strings.NewReader("event: response.output_text.delta\ndata: {\"delta\":\"partial\"}\n\nevent: response.output_item.done\ndata: {\"type\":\"function_call\",\"id\":\"call-1\",\"name\":\"Read\",\"arguments\":{\"type\":\"response.completed\"}}\n\n"))
	close(out)
	var sawError, sawDone bool
	for event := range out {
		sawError = sawError || event.Type == "error"
		sawDone = sawDone || event.Type == "done"
	}
	if !sawError || sawDone {
		t.Fatalf("unterminated Gemini stream was not fail-closed: error=%v done=%v", sawError, sawDone)
	}
}

func TestGeminiInteractionsAttributesConfiguredCredentialOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-goog-api-key"); got != "gemini-secret" {
			t.Fatalf("unexpected API key header: %q", got)
		}
		http.Error(w, "quota exceeded", http.StatusTooManyRequests)
	}))
	defer server.Close()

	provider := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: server.URL, APIKey: "gemini-secret", Model: "gemini-test"})
	events, err := provider.Generate(context.Background(), GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	var dispatch *DispatchInfo
	var errorText string
	for event := range events {
		if event.Dispatch != nil {
			dispatch = event.Dispatch
		}
		if event.Type == "error" {
			errorText = event.Text
		}
	}
	if dispatch == nil || dispatch.Provider != "gemini" || dispatch.Model != "gemini-test" || dispatch.CredentialID != configuredCredentialID {
		t.Fatalf("failed request lost credential attribution: %+v", dispatch)
	}
	if errorText == "" {
		t.Fatal("expected an attributed error event")
	}
}

func TestGeminiInteractionsRequiresConfiguredAPIKey(t *testing.T) {
	provider := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: "http://127.0.0.1:65510", Model: "gemini-test"})
	if provider.client.Timeout != 90*time.Second {
		t.Fatalf("provider HTTP timeout = %s", provider.client.Timeout)
	}
	if provider.Configured() {
		t.Fatal("provider without an API key must not be configured")
	}
	if events, err := provider.Generate(context.Background(), GenerateRequest{}); events != nil || !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("expected unavailable error for missing API key, events=%v err=%v", events, err)
	}

	configured := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: "http://127.0.0.1:65510", APIKey: "gemini-secret", Model: "gemini-test"})
	if !configured.Configured() {
		t.Fatal("provider with a valid endpoint and API key must be configured")
	}
}

func TestGeminiInteractionsRejectsUnsafeRuntimeURL(t *testing.T) {
	const secret = "gemini-secret"
	_, err := NewProvider(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: "http://169.254.169.254/v1beta/interactions", APIKey: secret, Model: "gemini-test"})
	if err == nil {
		t.Fatal("metadata endpoint must be rejected")
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "169.254") {
		t.Fatalf("unsafe URL validation leaked input: %v", err)
	}
}

func TestGeminiInteractionsHTTPErrorDoesNotLeakCredentialsOrURLs(t *testing.T) {
	const apiKey = "AIza-gemini-secret"
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "x-goog-api-key="+apiKey+" Authorization: Bearer "+jwt+" https://private.example.test/path", http.StatusBadGateway)
	}))
	defer server.Close()

	provider := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: server.URL, APIKey: apiKey, Model: "gemini-test"})
	events, err := provider.Generate(context.Background(), GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	var errorText string
	for event := range events {
		if event.Type == "error" {
			errorText = event.Text
		}
	}
	if !strings.Contains(errorText, "502") {
		t.Fatalf("expected safe HTTP status error, got %q", errorText)
	}
	for _, secret := range []string{apiKey, "Bearer", jwt, server.URL, "private.example.test"} {
		if strings.Contains(errorText, secret) {
			t.Fatalf("HTTP error leaked %q in %q", secret, errorText)
		}
	}
}

func TestGeminiInteractionsRedirectErrorDoesNotLeakRequestURL(t *testing.T) {
	const apiKey = "AIza-gemini-secret"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, server.URL+"/redirect?x-goog-api-key="+apiKey, http.StatusFound)
	}))
	defer server.Close()

	provider := NewGeminiInteractions(config.ProviderConfig{Name: "gemini", Type: "gemini-interactions", BaseURL: server.URL, APIKey: apiKey, Model: "gemini-test"})
	events, err := provider.Generate(context.Background(), GenerateRequest{Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	var errorText string
	for event := range events {
		if event.Type == "error" {
			errorText = event.Text
		}
	}
	if errorText != "gemini provider request failed" {
		t.Fatalf("unexpected redirect error: %q", errorText)
	}
	for _, secret := range []string{apiKey, server.URL, "redirect"} {
		if strings.Contains(errorText, secret) {
			t.Fatalf("redirect error leaked %q in %q", secret, errorText)
		}
	}
}

func TestGeminiInteractionContentReplaysThoughtSignature(t *testing.T) {
	content := geminiInteractionContent([]ContentBlock{{
		Type:          "tool_use",
		ToolUseID:     "call-1",
		ToolName:      "Read",
		Input:         json.RawMessage(`{"file_path":"README.md"}`),
		ProviderState: json.RawMessage(`{"thought_signature":"signature-1"}`),
	}})
	if len(content) != 1 || content[0]["thought_signature"] != "signature-1" {
		t.Fatalf("expected thought signature in function replay, got %+v", content)
	}
	arguments, ok := content[0]["arguments"].(map[string]any)
	if !ok || arguments["file_path"] != "README.md" {
		t.Fatalf("unexpected function arguments: %+v", content[0])
	}
}

func TestSanitizeGeminiSchemaRecursesAndDropsUnsupportedKeywords(t *testing.T) {
	schema := sanitizeGeminiSchema(map[string]any{
		"type":                 "object",
		"$schema":              "https://json-schema.org/draft/2020-12/schema",
		"additionalProperties": false,
		"properties": map[string]any{
			"nested": map[string]any{
				"type":                 "array",
				"additionalProperties": false,
				"items": map[string]any{
					"type":       "object",
					"properties": map[string]any{"name": map[string]any{"type": "string", "default": "x"}},
					"required":   []any{"name", "unknown"},
				},
			},
		},
		"required": []any{"nested", "unknown"},
	})
	encoded, err := json.Marshal(schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, unsupported := range []string{"$schema", "additionalProperties", "default", "unknown"} {
		if strings.Contains(string(encoded), unsupported) {
			t.Fatalf("sanitized schema still includes %q: %s", unsupported, encoded)
		}
	}
}

func TestGeminiInteractionsAccumulatesFunctionArgumentsUntilStepStop(t *testing.T) {
	stream := strings.Join([]string{
		"event: step.start",
		`data: {"event_type":"step.start","step":{"type":"thought","id":"thought-1","thought_signature":"sig-1","content":"checking"}}`,
		"",
		"event: step.start",
		`data: {"event_type":"step.start","step":{"type":"function_call","id":"call-1","name":"Read"}}`,
		"",
		"event: step.delta",
		`data: {"event_type":"step.delta","step_id":"call-1","delta":{"type":"function_call_arguments","delta":"{\"file_"}}`,
		"",
		"event: step.delta",
		`data: {"event_type":"step.delta","step_id":"call-1","delta":{"type":"function_call_arguments","delta":"path\":\"README.md\"}"}}`,
		"",
		"event: step.stop",
		`data: {"event_type":"step.stop","step_id":"call-1"}`,
		"",
	}, "\n")
	out := make(chan Event, 8)
	go func() {
		defer close(out)
		handleGeminiInteractionsSSE(out, strings.NewReader(stream))
	}()
	var calls []ToolCall
	for event := range out {
		if event.Type == "tool_call" {
			calls = append(calls, *event.ToolCall)
		}
	}
	if len(calls) != 1 || string(calls[0].Input) != `{"file_path":"README.md"}` {
		t.Fatalf("unexpected calls: %+v", calls)
	}
	if geminiThoughtSignature(calls[0].ProviderState) != "sig-1" {
		t.Fatalf("thought step was not retained: %s", calls[0].ProviderState)
	}
}
