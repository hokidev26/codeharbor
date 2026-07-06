package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"codeharbor/internal/config"
)

type OpenAICompatible struct {
	cfg    config.OpenAICompatibleConfig
	client *http.Client
}

func NewOpenAICompatible(cfg config.OpenAICompatibleConfig) *OpenAICompatible {
	if cfg.Name == "" {
		cfg.Name = "openai-compatible"
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	return &OpenAICompatible{cfg: cfg, client: &http.Client{Timeout: 90 * time.Second}}
}

func (p *OpenAICompatible) Name() string { return p.cfg.Name }

func (p *OpenAICompatible) ListModels(ctx context.Context) ([]string, error) {
	if p.cfg.APIKey == "" && !p.cfg.APIKeyOptional {
		return []string{p.cfg.Model}, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(p.cfg.BaseURL, "/")+"/models", nil)
	if err != nil {
		return nil, err
	}
	if p.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("models request failed: %s", res.Status)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	models := make([]string, 0, len(body.Data))
	for _, item := range body.Data {
		models = append(models, item.ID)
	}
	if len(models) == 0 {
		models = append(models, p.cfg.Model)
	}
	return models, nil
}

func (p *OpenAICompatible) Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error) {
	out := make(chan Event, 8)
	go func() {
		defer close(out)
		if p.cfg.APIKey == "" && !p.cfg.APIKeyOptional {
			text := "OpenAI-compatible provider is not configured. Set OPENAI_COMPATIBLE_API_KEY or OPENAI_API_KEY to enable real model calls."
			out <- Event{Type: "text", Text: text}
			out <- Event{Type: "done", Done: true}
			return
		}
		model := req.Model
		if model == "" {
			model = p.cfg.Model
		}
		messages := make([]map[string]string, 0, len(req.Messages)+1)
		if req.SystemPrompt != "" {
			messages = append(messages, map[string]string{"role": "system", "content": req.SystemPrompt})
		}
		for _, message := range req.Messages {
			if message.Content == "" {
				continue
			}
			role := message.Role
			if role == "" {
				role = "user"
			}
			messages = append(messages, map[string]string{"role": role, "content": message.Content})
		}
		payload := map[string]any{"model": model, "messages": messages, "stream": false}
		data, err := json.Marshal(payload)
		if err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(p.cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(data))
		if err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		if p.cfg.APIKey != "" {
			httpReq.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
		}
		res, err := p.client.Do(httpReq)
		if err != nil {
			out <- Event{Type: "error", Text: fmt.Sprintf("%s provider request failed: %v", p.cfg.Name, err)}
			return
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			out <- Event{Type: "error", Text: fmt.Sprintf("%s model request failed: %s", p.cfg.Name, res.Status)}
			return
		}
		var body struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		text := ""
		if len(body.Choices) > 0 {
			text = body.Choices[0].Message.Content
		}
		out <- Event{Type: "text", Text: text}
		out <- Event{Type: "done", Done: true}
	}()
	return out, nil
}
