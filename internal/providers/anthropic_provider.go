package providers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"

	"autoto/internal/config"
)

type AnthropicProvider struct {
	cfg    config.ProviderConfig
	client anthropic.Client
}

func NewAnthropicProvider(cfg config.ProviderConfig) *AnthropicProvider {
	if cfg.Name == "" {
		cfg.Name = "anthropic"
	}
	if cfg.Model == "" {
		cfg.Model = "claude-sonnet-4-5"
	}
	if cfg.MaxTokens <= 0 {
		cfg.MaxTokens = 4096
	}
	opts := make([]option.RequestOption, 0, 2)
	if cfg.APIKey != "" {
		opts = append(opts, option.WithAPIKey(cfg.APIKey))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	return &AnthropicProvider{cfg: cfg, client: anthropic.NewClient(opts...)}
}

func (p *AnthropicProvider) Name() string { return p.cfg.Name }

func (p *AnthropicProvider) Capabilities() Capabilities {
	return Capabilities{Tools: true, Streaming: true, ImageInput: true}
}

func (p *AnthropicProvider) ListModels(ctx context.Context) ([]string, error) {
	if p.cfg.APIKey == "" {
		return []string{p.cfg.Model}, nil
	}
	page, err := p.client.Models.List(ctx, anthropic.ModelListParams{})
	if err != nil {
		return nil, err
	}
	models := make([]string, 0, len(page.Data))
	for _, model := range page.Data {
		if model.ID != "" {
			models = append(models, model.ID)
		}
	}
	if len(models) == 0 && p.cfg.Model != "" {
		models = append(models, p.cfg.Model)
	}
	return models, nil
}

func (p *AnthropicProvider) Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error) {
	out := make(chan Event, 8)
	go func() {
		defer close(out)
		if p.cfg.APIKey == "" {
			out <- Event{Type: "text", Text: "Anthropic provider is not configured. Set ANTHROPIC_API_KEY to enable Messages API calls."}
			out <- Event{Type: "done", Done: true, StopReason: "not_configured"}
			return
		}
		model := req.Model
		if model == "" {
			model = p.cfg.Model
		}
		messages, system := anthropicMessages(req.Messages, req.SystemPrompt)
		if len(messages) == 0 {
			messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock("Continue.")))
		}
		params := anthropic.MessageNewParams{
			Model:     anthropic.Model(model),
			MaxTokens: p.cfg.MaxTokens,
			Messages:  messages,
			System:    system,
			Tools:     anthropicTools(req.Tools),
		}
		applyAnthropicPromptCaching(&params)
		stream := p.client.Messages.NewStreaming(ctx, params)
		defer stream.Close()
		var acc anthropic.Message
		var usage Usage
		var stopReason string
		for stream.Next() {
			event := stream.Current()
			if err := acc.Accumulate(event); err != nil {
				out <- Event{Type: "error", Text: err.Error()}
				return
			}
			switch typed := event.AsAny().(type) {
			case anthropic.MessageStartEvent:
				usage = anthropicUsageFromUsage(typed.Message.Usage)
			case anthropic.ContentBlockDeltaEvent:
				if delta, ok := typed.Delta.AsAny().(anthropic.TextDelta); ok && delta.Text != "" {
					out <- Event{Type: "text", Text: delta.Text}
				}
			case anthropic.ContentBlockStopEvent:
				emitAnthropicToolCall(out, acc, typed.Index)
			case anthropic.MessageDeltaEvent:
				applyAnthropicDeltaUsage(&usage, typed.Usage)
				if typed.Delta.StopReason != "" {
					stopReason = string(typed.Delta.StopReason)
				}
			}
		}
		if err := stream.Err(); err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		if usage != (Usage{}) {
			out <- Event{Type: "usage", Usage: &usage}
		}
		if stopReason == "" {
			stopReason = string(acc.StopReason)
		}
		out <- Event{Type: "done", Done: true, StopReason: stopReason}
	}()
	return out, nil
}

func anthropicUsageFromUsage(usage anthropic.Usage) Usage {
	return Usage{
		InputTokens:       usage.InputTokens,
		OutputTokens:      usage.OutputTokens,
		CachedInputTokens: usage.CacheReadInputTokens,
		ReasoningTokens:   usage.OutputTokensDetails.ThinkingTokens,
	}
}

func applyAnthropicDeltaUsage(usage *Usage, delta anthropic.MessageDeltaUsage) {
	if delta.JSON.InputTokens.Valid() {
		usage.InputTokens = delta.InputTokens
	}
	if delta.JSON.OutputTokens.Valid() {
		usage.OutputTokens = delta.OutputTokens
	}
	if delta.JSON.CacheReadInputTokens.Valid() {
		usage.CachedInputTokens = delta.CacheReadInputTokens
	}
	if delta.JSON.OutputTokensDetails.Valid() {
		usage.ReasoningTokens = delta.OutputTokensDetails.ThinkingTokens
	}
}

func emitAnthropicToolCall(out chan<- Event, message anthropic.Message, index int64) {
	if index < 0 || index >= int64(len(message.Content)) {
		return
	}
	block := message.Content[index]
	if block.Type != "tool_use" || block.ID == "" || block.Name == "" {
		return
	}
	input := block.Input
	if len(input) == 0 {
		input = json.RawMessage(`{}`)
	}
	out <- Event{Type: "tool_call", ToolCall: &ToolCall{ID: block.ID, Name: block.Name, Input: input}}
}

func anthropicMessages(messages []Message, systemPrompt string) ([]anthropic.MessageParam, []anthropic.TextBlockParam) {
	out := make([]anthropic.MessageParam, 0, len(messages))
	system := make([]anthropic.TextBlockParam, 0, 1)
	if strings.TrimSpace(systemPrompt) != "" {
		system = append(system, anthropic.TextBlockParam{Text: systemPrompt})
	}
	for _, message := range messages {
		blocks := normalizeContentBlocks(message)
		if len(blocks) == 0 {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(message.Role)) {
		case "assistant":
			content := anthropicContentBlocks(blocks)
			if len(content) > 0 {
				out = append(out, anthropic.NewAssistantMessage(content...))
			}
		case "system":
			content := strings.TrimSpace(contentBlocksText(blocks))
			if content != "" {
				system = append(system, anthropic.TextBlockParam{Text: content})
			}
		default:
			content := anthropicContentBlocks(blocks)
			if len(content) > 0 {
				out = append(out, anthropic.NewUserMessage(content...))
			}
		}
	}
	return out, system
}

func anthropicContentBlocks(blocks []ContentBlock) []anthropic.ContentBlockParamUnion {
	out := make([]anthropic.ContentBlockParamUnion, 0, len(blocks))
	for _, block := range blocks {
		switch block.Type {
		case "tool_use":
			input := any(map[string]any{})
			if len(block.Input) > 0 {
				input = json.RawMessage(block.Input)
			}
			if block.ToolUseID != "" && block.ToolName != "" {
				out = append(out, anthropic.NewToolUseBlock(block.ToolUseID, input, block.ToolName))
			}
		case "tool_result":
			if block.ToolUseID != "" {
				out = append(out, anthropic.NewToolResultBlock(block.ToolUseID, block.Output, block.IsError))
			}
		case "image":
			if len(block.Data) > 0 {
				mimeType := strings.TrimSpace(block.MIMEType)
				if mimeType == "" {
					mimeType = "image/png"
				}
				out = append(out, anthropic.NewImageBlockBase64(mimeType, base64.StdEncoding.EncodeToString(block.Data)))
				continue
			}
			name := strings.TrimSpace(block.Filename)
			if name == "" {
				name = "image"
			}
			out = append(out, anthropic.NewTextBlock("[图片附件 "+name+" 已上传；当前缺少可传递的图片数据。]"))
		default:
			text := strings.TrimSpace(block.Text)
			if text != "" {
				out = append(out, anthropic.NewTextBlock(text))
			}
		}
	}
	return out
}

func anthropicTools(specs []ToolSpec) []anthropic.ToolUnionParam {
	if len(specs) == 0 {
		return nil
	}
	out := make([]anthropic.ToolUnionParam, 0, len(specs))
	for _, spec := range specs {
		name := strings.TrimSpace(spec.Name)
		if name == "" {
			continue
		}
		schema := anthropicToolInputSchema(spec.Schema)
		tool := anthropic.ToolUnionParamOfTool(schema, name)
		if tool.OfTool != nil && strings.TrimSpace(spec.Description) != "" {
			tool.OfTool.Description = param.NewOpt(spec.Description)
		}
		out = append(out, tool)
	}
	return out
}

const anthropicPromptCacheMinBytes = 4096

func applyAnthropicPromptCaching(params *anthropic.MessageNewParams) {
	if params == nil || anthropicPromptCacheFootprint(*params) < anthropicPromptCacheMinBytes {
		return
	}
	cacheControl := anthropic.NewCacheControlEphemeralParam()
	cacheControl.TTL = anthropic.CacheControlEphemeralTTLTTL5m
	if len(params.System) > 0 {
		params.System[len(params.System)-1].CacheControl = cacheControl
	}
	setLastAnthropicToolCache(params.Tools, cacheControl)
	setLastAnthropicMessageCache(params.Messages, cacheControl)
}

func anthropicPromptCacheFootprint(params anthropic.MessageNewParams) int {
	total := 0
	for _, block := range params.System {
		total += len(strings.TrimSpace(block.Text))
	}
	total += marshaledAnthropicParamLen(params.Tools)
	total += marshaledAnthropicParamLen(params.Messages)
	return total
}

func marshaledAnthropicParamLen(value any) int {
	data, err := json.Marshal(value)
	if err != nil {
		return 0
	}
	return len(data)
}

func setLastAnthropicToolCache(tools []anthropic.ToolUnionParam, cacheControl anthropic.CacheControlEphemeralParam) bool {
	for i := len(tools) - 1; i >= 0; i-- {
		if control := tools[i].GetCacheControl(); control != nil {
			*control = cacheControl
			return true
		}
	}
	return false
}

func setLastAnthropicMessageCache(messages []anthropic.MessageParam, cacheControl anthropic.CacheControlEphemeralParam) bool {
	for i := len(messages) - 1; i >= 0; i-- {
		if setLastAnthropicContentCache(messages[i].Content, cacheControl) {
			return true
		}
	}
	return false
}

func setLastAnthropicContentCache(blocks []anthropic.ContentBlockParamUnion, cacheControl anthropic.CacheControlEphemeralParam) bool {
	for i := len(blocks) - 1; i >= 0; i-- {
		if control := blocks[i].GetCacheControl(); control != nil {
			*control = cacheControl
			return true
		}
	}
	return false
}

func anthropicToolInputSchema(schema any) anthropic.ToolInputSchemaParam {
	input := anthropic.ToolInputSchemaParam{Properties: map[string]any{}}
	if object, ok := schema.(map[string]any); ok {
		if properties, ok := object["properties"]; ok {
			input.Properties = properties
		}
		if required, ok := stringSlice(object["required"]); ok {
			input.Required = required
		}
	}
	return input
}

func stringSlice(value any) ([]string, bool) {
	switch typed := value.(type) {
	case []string:
		return typed, true
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}
