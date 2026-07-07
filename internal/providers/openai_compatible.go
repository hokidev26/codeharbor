package providers

import (
	"bytes"
	"context"
	"encoding/base64"
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

func openAICompatibleMessages(req GenerateRequest) []map[string]any {
	messages := make([]map[string]any, 0, len(req.Messages)+1)
	if req.SystemPrompt != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.SystemPrompt})
	}
	for _, message := range req.Messages {
		role := strings.TrimSpace(message.Role)
		if role == "" {
			role = "user"
		}
		blocks := normalizeContentBlocks(message)
		if len(blocks) == 0 {
			continue
		}
		if !contentBlocksHaveImage(blocks) {
			messages = append(messages, map[string]any{"role": role, "content": contentBlocksText(blocks)})
			continue
		}
		content := make([]map[string]any, 0, len(blocks))
		for _, block := range blocks {
			switch block.Type {
			case "image":
				if len(block.Data) == 0 {
					continue
				}
				mimeType := strings.TrimSpace(block.MIMEType)
				if mimeType == "" {
					mimeType = "image/png"
				}
				content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(block.Data)}})
			default:
				text := strings.TrimSpace(block.Text)
				if text != "" {
					content = append(content, map[string]any{"type": "text", "text": text})
				}
			}
		}
		if len(content) > 0 {
			messages = append(messages, map[string]any{"role": role, "content": content})
		}
	}
	return messages
}

func normalizeContentBlocks(message Message) []ContentBlock {
	if len(message.Blocks) > 0 {
		return message.Blocks
	}
	content := strings.TrimSpace(message.Content)
	if content == "" {
		return nil
	}
	return []ContentBlock{{Type: "text", Text: content}}
}

func contentBlocksHaveImage(blocks []ContentBlock) bool {
	for _, block := range blocks {
		if block.Type == "image" && len(block.Data) > 0 {
			return true
		}
	}
	return false
}

func contentBlocksText(blocks []ContentBlock) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if strings.TrimSpace(block.Text) != "" {
			parts = append(parts, strings.TrimSpace(block.Text))
			continue
		}
		switch block.Type {
		case "image":
			name := strings.TrimSpace(block.Filename)
			if name == "" {
				name = "image"
			}
			parts = append(parts, fmt.Sprintf("[图片附件 %s 已上传；当前 provider adapter 未以视觉格式传递该图片。]", name))
		case "tool_use":
			parts = append(parts, fmt.Sprintf("[Tool requested: %s (%s)]", block.ToolName, block.ToolUseID))
		case "tool_result":
			status := "completed"
			if block.IsError {
				status = "error"
			}
			parts = append(parts, fmt.Sprintf("[Tool result for %s (%s), %s]\n%s", block.ToolName, block.ToolUseID, status, strings.TrimSpace(block.Output)))
		}
	}
	return strings.Join(parts, "\n\n")
}

func (p *OpenAICompatible) Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error) {
	out := make(chan Event, 8)
	go func() {
		defer close(out)
		if p.cfg.APIKey == "" && !p.cfg.APIKeyOptional {
			text := "OpenAI-compatible provider is not configured. Set OPENAI_COMPATIBLE_API_KEY or OPENAI_API_KEY to enable real model calls."
			out <- Event{Type: "text", Text: text}
			out <- Event{Type: "done", Done: true, StopReason: "not_configured"}
			return
		}
		model := req.Model
		if model == "" {
			model = p.cfg.Model
		}
		messages := openAICompatibleMessages(req)
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
			Usage struct {
				PromptTokens        int64 `json:"prompt_tokens"`
				CompletionTokens    int64 `json:"completion_tokens"`
				InputTokens         int64 `json:"input_tokens"`
				OutputTokens        int64 `json:"output_tokens"`
				PromptTokensDetails struct {
					CachedTokens int64 `json:"cached_tokens"`
				} `json:"prompt_tokens_details"`
				CompletionTokensDetails struct {
					ReasoningTokens int64 `json:"reasoning_tokens"`
				} `json:"completion_tokens_details"`
				InputTokensDetails struct {
					CachedTokens int64 `json:"cached_tokens"`
				} `json:"input_tokens_details"`
				OutputTokensDetails struct {
					ReasoningTokens int64 `json:"reasoning_tokens"`
				} `json:"output_tokens_details"`
			} `json:"usage"`
		}
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			out <- Event{Type: "error", Text: err.Error()}
			return
		}
		usage := Usage{InputTokens: body.Usage.InputTokens, OutputTokens: body.Usage.OutputTokens, CachedInputTokens: body.Usage.InputTokensDetails.CachedTokens, ReasoningTokens: body.Usage.OutputTokensDetails.ReasoningTokens}
		if usage.InputTokens == 0 {
			usage.InputTokens = body.Usage.PromptTokens
			usage.CachedInputTokens = body.Usage.PromptTokensDetails.CachedTokens
		}
		if usage.OutputTokens == 0 {
			usage.OutputTokens = body.Usage.CompletionTokens
			usage.ReasoningTokens = body.Usage.CompletionTokensDetails.ReasoningTokens
		}
		out <- Event{Type: "usage", Usage: &usage}
		text := ""
		if len(body.Choices) > 0 {
			text = body.Choices[0].Message.Content
		}
		out <- Event{Type: "text", Text: text}
		out <- Event{Type: "done", Done: true}
	}()
	return out, nil
}
