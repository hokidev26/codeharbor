package providers

import (
	"context"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

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
			out <- Event{Type: "done", Done: true}
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
		}
		res, err := p.client.Messages.New(ctx, params)
		if err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		var builder strings.Builder
		for _, block := range res.Content {
			if block.Type == "text" {
				builder.WriteString(block.Text)
			}
		}
		out <- Event{Type: "text", Text: builder.String()}
		out <- Event{Type: "done", Done: true}
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
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(message.Role)) {
		case "assistant":
			out = append(out, anthropic.NewAssistantMessage(anthropic.NewTextBlock(content)))
		case "system":
			system = append(system, anthropic.TextBlockParam{Text: content})
		default:
			out = append(out, anthropic.NewUserMessage(anthropic.NewTextBlock(content)))
		}
	}
	return out, system
}
