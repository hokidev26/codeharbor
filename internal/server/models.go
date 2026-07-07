package server

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"codeharbor/internal/config"
)

const modelListTimeout = 5 * time.Second

type modelsResponse struct {
	Providers []modelProviderResponse `json:"providers"`
}

type modelProviderResponse struct {
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	BaseURL        string   `json:"baseUrl,omitempty"`
	DefaultModel   string   `json:"defaultModel"`
	MaxTokens      int64    `json:"maxTokens,omitempty"`
	Models         []string `json:"models"`
	Configured     bool     `json:"configured"`
	APIKeyOptional bool     `json:"apiKeyOptional,omitempty"`
	ManagementURL  string   `json:"managementUrl,omitempty"`
	Error          string   `json:"error,omitempty"`
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	providers := s.configSnapshot().Providers.Summaries()
	out := modelsResponse{Providers: make([]modelProviderResponse, 0, len(providers))}
	for _, provider := range providers {
		out.Providers = append(out.Providers, s.modelProviderResponse(r.Context(), provider))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) modelProviderResponse(ctx context.Context, provider config.ProviderSummary) modelProviderResponse {
	response := modelProviderResponse{
		Name:           provider.Name,
		Type:           provider.Type,
		BaseURL:        provider.BaseURL,
		DefaultModel:   provider.Model,
		MaxTokens:      provider.MaxTokens,
		Models:         fallbackModels(provider.Model),
		Configured:     provider.Configured,
		APIKeyOptional: provider.APIKeyOptional,
		ManagementURL:  providerManagementURL(provider),
	}
	if s.providers == nil {
		response.Error = "模型注册表尚未初始化。"
		return response
	}
	registered, ok := s.providers.Get(provider.Name)
	if !ok {
		response.Error = fmt.Sprintf("provider %s 尚未注册。", provider.Name)
		return response
	}
	listCtx, cancel := context.WithTimeout(ctx, modelListTimeout)
	defer cancel()
	models, err := registered.ListModels(listCtx)
	if err != nil {
		response.Error = friendlyModelListError(provider, err)
		return response
	}
	response.Models = normalizeModelNames(models, provider.Model)
	return response
}

func fallbackModels(defaultModel string) []string {
	if strings.TrimSpace(defaultModel) == "" {
		return []string{}
	}
	return []string{strings.TrimSpace(defaultModel)}
}

func normalizeModelNames(models []string, defaultModel string) []string {
	seen := make(map[string]bool, len(models)+1)
	out := make([]string, 0, len(models)+1)
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" || seen[model] {
			continue
		}
		seen[model] = true
		out = append(out, model)
	}
	if len(out) == 0 {
		out = fallbackModels(defaultModel)
	}
	sort.Strings(out)
	return out
}

func friendlyModelListError(provider config.ProviderSummary, err error) string {
	message := err.Error()
	lower := strings.ToLower(message)
	if provider.Name == "cliproxyapi" {
		switch {
		case strings.Contains(lower, "connection refused"), strings.Contains(lower, "no such host"), strings.Contains(lower, "connect:"):
			return "无法连接本地 CLIProxyAPI。请先启动 CLIProxyAPI，然后点击刷新模型。"
		case strings.Contains(lower, "401") || strings.Contains(lower, "unauthorized"):
			return "CLIProxyAPI 返回 401。请确认 CLIProxyAPI 的 api-keys 配置；如启用了客户端鉴权，请设置 CLIPROXYAPI_API_KEY 后重启 CodeHarbor。"
		case strings.Contains(lower, "403"):
			return "CLIProxyAPI 拒绝了模型列表请求。请检查账号登录状态、权限或 API key 配置。"
		case strings.Contains(lower, "context deadline exceeded"):
			return "连接 CLIProxyAPI 超时。请确认它正在运行并可访问。"
		}
		return "无法从 CLIProxyAPI 获取模型列表：" + message
	}
	return "无法获取模型列表：" + message
}

func providerManagementURL(provider config.ProviderSummary) string {
	if provider.Name != "cliproxyapi" {
		return ""
	}
	baseURL := provider.BaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "http://127.0.0.1:8317/v1"
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "http://127.0.0.1:8317/management.html"
	}
	parsed.Path = "/management.html"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
