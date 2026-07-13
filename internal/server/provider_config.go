package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
	"autoto/internal/providers"
)

type providerConfigUpdateRequest struct {
	Name           string `json:"name"`
	Type           string `json:"type"`
	Profile        string `json:"profile"`
	BaseURL        string `json:"baseUrl"`
	APIKey         string `json:"apiKey"`
	Model          string `json:"model"`
	MaxTokens      int64  `json:"maxTokens"`
	APIKeyOptional bool   `json:"apiKeyOptional"`
}

type providerConfigUpdateResponse struct {
	Provider        config.ProviderSummary `json:"provider"`
	Persisted       bool                   `json:"persisted"`
	APIKeyPersisted bool                   `json:"apiKeyPersisted"`
	Message         string                 `json:"message"`
}

func (s *Server) updateProviderConfig(w http.ResponseWriter, r *http.Request) {
	providerName := strings.TrimSpace(chi.URLParam(r, "name"))
	if providerName == "" {
		writeError(w, http.StatusBadRequest, "provider name is required")
		return
	}
	if err := validateProviderName(providerName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req providerConfigUpdateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	existing := s.providerConfig(providerName)
	updated, err := providerConfigFromUpdateRequest(providerName, existing, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateProviderRegistration(updated); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.cfgMu.RLock()
	cfg := s.cfg
	cfg.Providers.Instances = upsertServerProvider(cfg.Providers.Instances, updated)
	configPath := s.configPath
	s.cfgMu.RUnlock()

	persisted := false
	if configPath != "" {
		if err := config.Save(configPath, cfg); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存配置失败：%v", err))
			return
		}
		persisted = true
	}
	if err := s.registerProvider(updated); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.providers != nil {
		s.providers.SetDefaultFromConfig(cfg.Agent.DefaultModel, cfg.Providers.Instances)
	}
	s.cfgMu.Lock()
	s.cfg = cfg
	s.cfgMu.Unlock()

	writeJSON(w, http.StatusOK, providerConfigUpdateResponse{
		Provider:        updated.Summary(),
		Persisted:       persisted,
		APIKeyPersisted: false,
		Message:         "配置已在当前运行时生效；API Key 不写入磁盘，重启后请通过环境变量或重新保存。",
	})
}

func (s *Server) providerConfig(name string) config.ProviderConfig {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	for _, provider := range s.cfg.Providers.Instances {
		if provider.Name == name {
			return config.NormalizeProviderConfig(provider)
		}
	}
	return config.ProviderConfig{}
}

func providerConfigFromUpdateRequest(providerName string, existing config.ProviderConfig, req providerConfigUpdateRequest) (config.ProviderConfig, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = providerName
	}
	if err := validateProviderName(name); err != nil {
		return config.ProviderConfig{}, err
	}
	if name != providerName {
		return config.ProviderConfig{}, errors.New("暂不支持在此处重命名 provider，请保持供应商名称不变")
	}
	providerType := strings.TrimSpace(req.Type)
	if providerType == "" && existing.Name == name {
		providerType = existing.Type
	}
	if providerType == "" {
		providerType = "openai-compatible"
	}
	switch providerType {
	case "openai-compatible", "anthropic", "openai":
	default:
		return config.ProviderConfig{}, errors.New("API 协议当前仅支持 openai-compatible、anthropic 或 openai")
	}
	baseURL := strings.TrimSpace(req.BaseURL)
	if providerType == "openai-compatible" && baseURL == "" {
		return config.ProviderConfig{}, errors.New("中转站 Base URL 不能为空")
	}
	model := strings.TrimSpace(req.Model)
	if model == "" && existing.Name == name {
		model = existing.Model
	}
	if model == "" {
		switch providerType {
		case "anthropic":
			model = "claude-sonnet-4-5"
		default:
			model = "gpt-4.1-mini"
		}
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 && existing.Name == name {
		maxTokens = existing.MaxTokens
	}
	if providerType == "anthropic" && maxTokens <= 0 {
		maxTokens = 4096
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" && existing.Name == name {
		apiKey = existing.APIKey
	}
	profile := strings.TrimSpace(req.Profile)
	if profile == "" && existing.Name == name {
		profile = existing.Profile
	}
	if err := validateProviderProfile(profile); err != nil {
		return config.ProviderConfig{}, err
	}
	apiKeyOptional := req.APIKeyOptional
	if existing.Name == name && existing.APIKeyOptional {
		apiKeyOptional = true
	}
	return config.ProviderConfig{
		Name:           name,
		Type:           providerType,
		Profile:        profile,
		BaseURL:        baseURL,
		APIKey:         apiKey,
		Model:          model,
		MaxTokens:      maxTokens,
		APIKeyOptional: apiKeyOptional,
	}, nil
}

func validateProviderName(name string) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("provider name is required")
	}
	if len(name) > 64 {
		return errors.New("Provider 名称最多 64 个字符")
	}
	for i, r := range name {
		if i == 0 && !isProviderNameAlphaNumeric(r) {
			return errors.New("Provider 名称必须以英文字母或数字开头，且只能包含英文字母、数字、点、下划线和中横线")
		}
		if !isProviderNameChar(r) {
			return errors.New("Provider 名称只能包含英文字母、数字、点、下划线和中横线")
		}
	}
	return nil
}

func validateProviderProfile(profile string) error {
	switch strings.TrimSpace(profile) {
	case "", config.ProviderProfileCLIProxyAPI:
		return nil
	default:
		return fmt.Errorf("unsupported provider profile %q", profile)
	}
}

func isProviderNameAlphaNumeric(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func isProviderNameChar(r rune) bool {
	return isProviderNameAlphaNumeric(r) || r == '.' || r == '_' || r == '-'
}

func validateProviderRegistration(provider config.ProviderConfig) error {
	_, err := providers.NewProvider(provider)
	return err
}

func (s *Server) registerProvider(provider config.ProviderConfig) error {
	adapter, err := providers.NewProvider(provider)
	if err != nil {
		return err
	}
	if s.providers == nil {
		s.providers = providers.NewRegistry()
	}
	s.providers.Register(adapter)
	return nil
}

func upsertServerProvider(items []config.ProviderConfig, provider config.ProviderConfig) []config.ProviderConfig {
	out := append([]config.ProviderConfig(nil), items...)
	for i, existing := range out {
		if existing.Name == provider.Name {
			out[i] = provider
			return out
		}
	}
	return append(out, provider)
}
