package providers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"

	"codeharbor/internal/config"
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
		res, err := p.client.Messages.New(ctx, params)
		if err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		usage := Usage{
			InputTokens:       res.Usage.InputTokens,
			OutputTokens:      res.Usage.OutputTokens,
			CachedInputTokens: res.Usage.CacheReadInputTokens,
			ReasoningTokens:   res.Usage.OutputTokensDetails.ThinkingTokens,
		}
		out <- Event{Type: "usage", Usage: &usage}
		for _, block := range res.Content {
			switch block.Type {
			case "text":
				out <- Event{Type: "text", Text: block.Text}
			case "tool_use":
				input := block.Input
				if len(input) == 0 {
					input = json.RawMessage(`{}`)
				}
				out <- Event{Type: "tool_call", ToolCall: &ToolCall{ID: block.ID, Name: block.Name, Input: input}}
			}
		}
		out <- Event{Type: "done", Done: true, StopReason: string(res.StopReason)}
	}()
	return out, nil
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
