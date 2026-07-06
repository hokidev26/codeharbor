package providers

import (
	"context"
	"fmt"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/responses"

	"codeharbor/internal/config"
)

type OpenAIOfficial struct {
	cfg    config.ProviderConfig
	client openai.Client
}

func NewOpenAIOfficial(cfg config.ProviderConfig) *OpenAIOfficial {
	if cfg.Name == "" {
		cfg.Name = "openai"
	}
	if cfg.Model == "" {
		cfg.Model = "gpt-4.1-mini"
	}
	opts := make([]option.RequestOption, 0, 2)
	if cfg.APIKey != "" {
		opts = append(opts, option.WithAPIKey(cfg.APIKey))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	return &OpenAIOfficial{cfg: cfg, client: openai.NewClient(opts...)}
}

func (p *OpenAIOfficial) Name() string { return p.cfg.Name }

func (p *OpenAIOfficial) ListModels(ctx context.Context) ([]string, error) {
	if p.cfg.APIKey == "" {
		return []string{p.cfg.Model}, nil
	}
	page, err := p.client.Models.List(ctx)
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

func (p *OpenAIOfficial) Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error) {
	out := make(chan Event, 8)
	go func() {
		defer close(out)
		if p.cfg.APIKey == "" {
			out <- Event{Type: "text", Text: "OpenAI official provider is not configured. Set OPENAI_API_KEY to enable Responses API calls."}
			out <- Event{Type: "done", Done: true}
			return
		}
		model := req.Model
		if model == "" {
			model = p.cfg.Model
		}
		input := renderTranscript(req.Messages)
		if input == "" {
			input = "Continue."
		}
		params := responses.ResponseNewParams{
			Model: model,
			Input: responses.ResponseNewParamsInputUnion{OfString: param.NewOpt(input)},
		}
		if req.SystemPrompt != "" {
			params.Instructions = param.NewOpt(req.SystemPrompt)
		}
		res, err := p.client.Responses.New(ctx, params)
		if err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		if res.Error.Message != "" {
			out <- Event{Type: "error", Text: fmt.Sprintf("openai response error: %s", res.Error.Message)}
			return
		}
		text := res.OutputText()
		out <- Event{Type: "text", Text: text}
		out <- Event{Type: "done", Done: true}
	}()
	return out, nil
}

func renderTranscript(messages []Message) string {
	var builder strings.Builder
	for _, message := range messages {
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		role := strings.TrimSpace(message.Role)
		if role == "" {
			role = "user"
		}
		if builder.Len() > 0 {
			builder.WriteString("\n\n")
		}
		builder.WriteString(strings.ToUpper(role[:1]))
		if len(role) > 1 {
			builder.WriteString(strings.ToLower(role[1:]))
		}
		builder.WriteString(": ")
		builder.WriteString(content)
	}
	return builder.String()
}
