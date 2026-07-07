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
			out <- Event{Type: "done", Done: true, StopReason: "not_configured"}
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
		stream := p.client.Responses.NewStreaming(ctx, params)
		defer stream.Close()
		sawDelta := false
		for stream.Next() {
			event := stream.Current()
			switch event.Type {
			case "response.output_text.delta":
				delta := event.AsResponseOutputTextDelta()
				if delta.Delta != "" {
					sawDelta = true
					out <- Event{Type: "text", Text: delta.Delta}
				}
			case "response.output_text.done":
				done := event.AsResponseOutputTextDone()
				if !sawDelta && done.Text != "" {
					sawDelta = true
					out <- Event{Type: "text", Text: done.Text}
				}
			case "response.completed":
				completed := event.AsResponseCompleted()
				if errText := openAIResponseErrorText(completed.Response); errText != "" {
					out <- Event{Type: "error", Text: errText}
					return
				}
				emitOpenAIUsage(out, completed.Response)
				out <- Event{Type: "done", Done: true}
				return
			case "response.incomplete":
				incomplete := event.AsResponseIncomplete()
				emitOpenAIUsage(out, incomplete.Response)
				out <- Event{Type: "done", Done: true, StopReason: openAIIncompleteStopReason(incomplete.Response)}
				return
			case "response.failed":
				failed := event.AsResponseFailed()
				emitOpenAIUsage(out, failed.Response)
				if errText := openAIResponseErrorText(failed.Response); errText != "" {
					out <- Event{Type: "error", Text: errText}
					return
				}
				out <- Event{Type: "error", Text: "openai response failed"}
				return
			case "error":
				errEvent := event.AsError()
				out <- Event{Type: "error", Text: openAIStreamErrorText(errEvent)}
				return
			}
		}
		if err := stream.Err(); err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		out <- Event{Type: "done", Done: true}
	}()
	return out, nil
}

func emitOpenAIUsage(out chan<- Event, response responses.Response) {
	usage := openAIUsageFromResponse(response)
	if usage == (Usage{}) {
		return
	}
	out <- Event{Type: "usage", Usage: &usage}
}

func openAIUsageFromResponse(response responses.Response) Usage {
	return Usage{
		InputTokens:       response.Usage.InputTokens,
		OutputTokens:      response.Usage.OutputTokens,
		CachedInputTokens: response.Usage.InputTokensDetails.CachedTokens,
		ReasoningTokens:   response.Usage.OutputTokensDetails.ReasoningTokens,
	}
}

func openAIResponseErrorText(response responses.Response) string {
	if strings.TrimSpace(response.Error.Message) == "" {
		return ""
	}
	if strings.TrimSpace(string(response.Error.Code)) != "" {
		return fmt.Sprintf("openai response error (%s): %s", response.Error.Code, response.Error.Message)
	}
	return fmt.Sprintf("openai response error: %s", response.Error.Message)
}

func openAIIncompleteStopReason(response responses.Response) string {
	if strings.TrimSpace(response.IncompleteDetails.Reason) != "" {
		return response.IncompleteDetails.Reason
	}
	if response.Status != "" {
		return string(response.Status)
	}
	return "incomplete"
}

func openAIStreamErrorText(event responses.ResponseErrorEvent) string {
	if strings.TrimSpace(event.Code) != "" {
		return fmt.Sprintf("openai stream error (%s): %s", event.Code, event.Message)
	}
	return fmt.Sprintf("openai stream error: %s", event.Message)
}

func renderTranscript(messages []Message) string {
	var builder strings.Builder
	for _, message := range messages {
		content := strings.TrimSpace(contentBlocksText(normalizeContentBlocks(message)))
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
