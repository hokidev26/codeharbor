package server

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"autoto/internal/config"
	"autoto/internal/providers"
)

const modelListTimeout = 5 * time.Second

type modelsResponse struct {
	Providers []modelProviderResponse `json:"providers"`
}

type providerManagementResponse struct {
	URL       string `json:"url,omitempty"`
	AuthFiles bool   `json:"authFiles,omitempty"`
}

type modelProviderResponse struct {
	Name           string                      `json:"name"`
	Type           string                      `json:"type"`
	Profile        string                      `json:"profile,omitempty"`
	BaseURL        string                      `json:"baseUrl,omitempty"`
	DefaultModel   string                      `json:"defaultModel"`
	MaxTokens      int64                       `json:"maxTokens,omitempty"`
	Models         []string                    `json:"models"`
	ModelsSource   string                      `json:"modelsSource"`
	Available      bool                        `json:"available"`
	Discovered     bool                        `json:"discovered"`
	Configured     bool                        `json:"configured"`
	APIKeyOptional bool                        `json:"apiKeyOptional,omitempty"`
	Capabilities   providers.Capabilities      `json:"capabilities"`
	Management     *providerManagementResponse `json:"management,omitempty"`
	ManagementURL  string                      `json:"managementUrl,omitempty"`
	Error          string                      `json:"error,omitempty"`
}

// providerSettingsMetadata is ready for the settings response to compose with
// config summaries. Route integration intentionally remains separate.
type providerSettingsMetadata struct {
	Profile      string                      `json:"profile,omitempty"`
	Capabilities providers.Capabilities      `json:"capabilities"`
	Management   *providerManagementResponse `json:"management,omitempty"`
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
	metadata := s.providerSettingsMetadata(provider)
	response := modelProviderResponse{
		Name:           provider.Name,
		Type:           provider.Type,
		Profile:        metadata.Profile,
		BaseURL:        provider.BaseURL,
		DefaultModel:   provider.Model,
		MaxTokens:      provider.MaxTokens,
		Models:         fallbackModels(provider.Model),
		ModelsSource:   "configured-default",
		Configured:     provider.Configured,
		APIKeyOptional: provider.APIKeyOptional,
		Capabilities:   metadata.Capabilities,
		Management:     metadata.Management,
		ManagementURL:  providerManagementURL(provider),
	}
	if s.providers == nil {
		response.ModelsSource = "fallback"
		response.Error = "模型注册表尚未初始化。"
		return response
	}
	registered, ok := s.providers.Get(provider.Name)
	if !ok {
		response.ModelsSource = "fallback"
		response.Error = fmt.Sprintf("provider %s 尚未注册。", provider.Name)
		return response
	}
	response.Capabilities = providers.CapabilitiesFor(registered)
	listCtx, cancel := context.WithTimeout(ctx, modelListTimeout)
	defer cancel()
	models, err := registered.ListModels(listCtx)
	if err != nil {
		response.ModelsSource = "fallback"
		response.Error = friendlyModelListError(provider, err)
		return response
	}
	response.Models = normalizeModelNames(models, provider.Model)
	response.ModelsSource = "remote"
	response.Discovered = len(response.Models) > 0
	response.Available = response.Configured && response.Discovered
	return response
}

func (s *Server) providerSettingsMetadata(provider config.ProviderSummary) providerSettingsMetadata {
	metadata := providerSettingsMetadata{Profile: provider.Profile}
	if provider.Profile == config.ProviderProfileCLIProxyAPI {
		metadata.Management = &providerManagementResponse{
			URL:       providerManagementURL(provider),
			AuthFiles: true,
		}
	}
	if s.providers != nil {
		if registered, ok := s.providers.Get(provider.Name); ok {
			metadata.Capabilities = providers.CapabilitiesFor(registered)
		}
	}
	return metadata
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
	if provider.Profile == config.ProviderProfileCLIProxyAPI {
		switch {
		case strings.Contains(lower, "connection refused"), strings.Contains(lower, "no such host"), strings.Contains(lower, "connect:"):
			return "无法连接本地 CLIProxyAPI。请先启动 CLIProxyAPI，然后点击刷新模型。"
		case strings.Contains(lower, "401") || strings.Contains(lower, "unauthorized"):
			return "CLIProxyAPI 返回 401。请确认 CLIProxyAPI 的 api-keys 配置；如启用了客户端鉴权，请设置 CLIPROXYAPI_API_KEY 后重启 Autoto。"
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
	if provider.Profile != config.ProviderProfileCLIProxyAPI {
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
