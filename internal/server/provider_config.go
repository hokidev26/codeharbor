package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"autoto/internal/anthropicauth"
	"autoto/internal/codexauth"
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

type providerConfigPatchRequest struct {
	Enabled *bool   `json:"enabled"`
	Model   *string `json:"model"`
}

type providerDeleteResponse struct {
	Deleted   bool   `json:"deleted"`
	Name      string `json:"name"`
	Persisted bool   `json:"persisted"`
}

type providerTestResponse struct {
	Reachable  bool     `json:"reachable"`
	Configured bool     `json:"configured"`
	ModelCount int      `json:"modelCount"`
	Models     []string `json:"models,omitempty"`
	ErrorCode  string   `json:"errorCode,omitempty"`
	Message    string   `json:"message"`
}

const (
	providerTestTimeout          = 3 * time.Second
	maxProviderConfigRequestSize = 32 << 10
	maxProviderBaseURLBytes      = 2048
	maxProviderAPIKeyBytes       = 16 << 10
	maxProviderModelBytes        = 512
	maxProviderProfileBytes      = 64
)

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
	if err := decodeProviderConfigUpdateRequest(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Keep the full config read-modify-save-publish transaction serialized with
	// security and continuation updates. The global config lock is always
	// acquired before the narrower provider runtime lock.
	s.configMutationMu.Lock()
	defer s.configMutationMu.Unlock()
	s.providerMutationMu.Lock()
	defer s.providerMutationMu.Unlock()
	existing, _ := s.providerConfig(providerName)
	updated, err := providerConfigFromUpdateRequest(providerName, existing, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	adapter, err := s.newRuntimeProvider(updated)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.cfgMu.RLock()
	cfg := s.cfg
	cfg.Providers.Instances = upsertServerProvider(cfg.Providers.Instances, updated)
	configPath := s.configPath
	s.cfgMu.RUnlock()
	if err := s.ensureProviderDefaultAfterMutation(cfg, providerName); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	s.runProviderMutationHook()
	persisted, err := s.persistProviderConfig(configPath, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存配置失败：%v", err))
		return
	}
	if updated.Disabled {
		s.unregisterProvider(updated.Name)
	} else {
		s.registerProviderAdapter(adapter)
	}
	s.refreshProviderDefault(cfg)
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

func (s *Server) patchProviderConfig(w http.ResponseWriter, r *http.Request) {
	providerName := strings.TrimSpace(chi.URLParam(r, "name"))
	if err := validateProviderName(providerName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req providerConfigPatchRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Enabled == nil && req.Model == nil {
		writeError(w, http.StatusBadRequest, "enabled or model is required")
		return
	}
	s.configMutationMu.Lock()
	defer s.configMutationMu.Unlock()
	s.providerMutationMu.Lock()
	defer s.providerMutationMu.Unlock()
	existing, ok := s.providerConfig(providerName)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}

	updated := existing
	if req.Enabled != nil {
		updated.Disabled = !*req.Enabled
	}
	if req.Model != nil {
		updated.Model = strings.TrimSpace(*req.Model)
		if updated.Model == "" {
			writeError(w, http.StatusBadRequest, "model must not be empty")
			return
		}
		if len(updated.Model) > maxProviderModelBytes || strings.ContainsAny(updated.Model, "\x00\r\n") {
			writeError(w, http.StatusBadRequest, "model is invalid")
			return
		}
	}

	adapter, err := s.newRuntimeProvider(updated)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.cfgMu.RLock()
	cfg := s.cfg
	cfg.Providers.Instances = upsertServerProvider(cfg.Providers.Instances, updated)
	configPath := s.configPath
	s.cfgMu.RUnlock()
	if err := s.ensureProviderDefaultAfterMutation(cfg, providerName); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	s.runProviderMutationHook()
	persisted, err := s.persistProviderConfig(configPath, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存配置失败：%v", err))
		return
	}
	if updated.Disabled {
		s.unregisterProvider(updated.Name)
	} else {
		s.registerProviderAdapter(adapter)
	}
	s.refreshProviderDefault(cfg)
	s.cfgMu.Lock()
	s.cfg = cfg
	s.cfgMu.Unlock()

	writeJSON(w, http.StatusOK, providerConfigUpdateResponse{
		Provider:        updated.Summary(),
		Persisted:       persisted,
		APIKeyPersisted: false,
		Message:         "Provider 生命周期更新已在当前运行时生效。",
	})
}

func (s *Server) deleteProviderConfig(w http.ResponseWriter, r *http.Request) {
	providerName := strings.TrimSpace(chi.URLParam(r, "name"))
	if err := validateProviderName(providerName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.configMutationMu.Lock()
	defer s.configMutationMu.Unlock()
	s.providerMutationMu.Lock()
	defer s.providerMutationMu.Unlock()
	existing, ok := s.providerConfig(providerName)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}
	if config.IsBuiltinProviderName(existing.Name) {
		writeError(w, http.StatusConflict, "built-in providers cannot be deleted")
		return
	}

	s.cfgMu.RLock()
	cfg := s.cfg
	var removed bool
	cfg.Providers.Instances, removed = removeServerProvider(cfg.Providers.Instances, providerName)
	configPath := s.configPath
	s.cfgMu.RUnlock()
	if !removed {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err := s.ensureProviderDefaultAfterMutation(cfg, providerName); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	s.runProviderMutationHook()
	persisted, err := s.persistProviderConfig(configPath, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存配置失败：%v", err))
		return
	}
	s.unregisterProvider(providerName)
	s.refreshProviderDefault(cfg)
	s.cfgMu.Lock()
	s.cfg = cfg
	s.cfgMu.Unlock()
	writeJSON(w, http.StatusOK, providerDeleteResponse{Deleted: true, Name: providerName, Persisted: persisted})
}

func (s *Server) testProviderConfig(w http.ResponseWriter, r *http.Request) {
	if err := rejectProviderTestBody(r); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	providerName := strings.TrimSpace(chi.URLParam(r, "name"))
	if err := validateProviderName(providerName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	provider, ok := s.providerConfig(providerName)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}
	s.testProviderAdapter(w, r, provider)
}

// testProviderConfigDraft validates and tests a full configuration draft without
// writing it to disk or changing the runtime registry. A blank draft API key may
// reuse the same named provider's in-memory key so users can test non-secret
// fields without re-entering credentials.
func (s *Server) testProviderConfigDraft(w http.ResponseWriter, r *http.Request) {
	var req providerConfigUpdateRequest
	if err := decodeProviderConfigUpdateRequest(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	providerName := strings.TrimSpace(req.Name)
	if err := validateProviderName(providerName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.providerMutationMu.Lock()
	existing, _ := s.providerConfig(providerName)
	provider, err := providerConfigFromUpdateRequest(providerName, existing, req)
	s.providerMutationMu.Unlock()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.newRuntimeProvider(provider); err != nil {
		writeError(w, http.StatusBadRequest, "Provider 配置无效。")
		return
	}
	s.testProviderAdapter(w, r, provider)
}

func (s *Server) testProviderAdapter(w http.ResponseWriter, r *http.Request, provider config.ProviderConfig) {
	adapter, err := s.newRuntimeProvider(provider)
	if err != nil {
		writeJSON(w, http.StatusOK, providerTestResponse{
			Configured: provider.IsConfigured(), ErrorCode: "invalid_configuration", Message: "Provider 配置无效。",
		})
		return
	}
	configured := providers.ConfiguredFor(adapter, provider.IsConfigured())
	if !configured && !provider.APIKeyOptional {
		writeJSON(w, http.StatusOK, providerTestResponse{
			Configured: false,
			ErrorCode:  "not_configured",
			Message:    "需要 API Key，尚未执行连接预检。",
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), providerTestTimeout)
	defer cancel()
	models, err := adapter.ListModels(ctx)
	if err != nil {
		errorCode, message, reachable := classifyProviderTestError(err)
		writeJSON(w, http.StatusOK, providerTestResponse{
			Reachable: reachable, Configured: configured, ErrorCode: errorCode, Message: message,
		})
		return
	}
	models = normalizeModelNames(models, provider.Model)
	writeJSON(w, http.StatusOK, providerTestResponse{
		Reachable: true, Configured: configured, ModelCount: len(models), Models: models, Message: "Provider 可访问。",
	})
}

func rejectProviderTestBody(r *http.Request) error {
	if r.ContentLength > 0 {
		return errors.New("provider test does not accept a request body")
	}
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 1))
	if err != nil {
		return errors.New("provider test request body is invalid")
	}
	if len(body) != 0 {
		return errors.New("provider test does not accept a request body")
	}
	return nil
}

func (s *Server) providerConfig(name string) (config.ProviderConfig, bool) {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	for _, provider := range s.cfg.Providers.Instances {
		if provider.Name == name {
			return config.NormalizeProviderConfig(provider), true
		}
	}
	return config.ProviderConfig{}, false
}

func decodeProviderConfigUpdateRequest(r *http.Request, dst *providerConfigUpdateRequest) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxProviderConfigRequestSize+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain exactly one JSON value")
		}
		return err
	}
	if err := validateProviderConfigRequest(*dst); err != nil {
		return err
	}
	return nil
}

func validateProviderConfigRequest(req providerConfigUpdateRequest) error {
	for _, field := range []struct {
		name  string
		value string
		limit int
	}{
		{name: "name", value: req.Name, limit: 64},
		{name: "type", value: req.Type, limit: 64},
		{name: "profile", value: req.Profile, limit: maxProviderProfileBytes},
		{name: "baseUrl", value: req.BaseURL, limit: maxProviderBaseURLBytes},
		{name: "apiKey", value: req.APIKey, limit: maxProviderAPIKeyBytes},
		{name: "model", value: req.Model, limit: maxProviderModelBytes},
	} {
		if len(field.value) > field.limit {
			return fmt.Errorf("%s exceeds size limit", field.name)
		}
		if strings.ContainsAny(field.value, "\x00\r\n") {
			return fmt.Errorf("%s contains invalid control characters", field.name)
		}
	}
	if req.MaxTokens < 0 || req.MaxTokens > 10_000_000 {
		return errors.New("maxTokens must be between 0 and 10000000")
	}
	return nil
}

func (s *Server) runProviderMutationHook() {
	if s.providerMutationHook != nil {
		s.providerMutationHook()
	}
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
	case "openai-compatible", "anthropic", "openai", "gemini-interactions", config.ProviderTypeCodex:
	default:
		return config.ProviderConfig{}, errors.New("API 协议当前仅支持 codex、openai-compatible、anthropic、openai 或 gemini-interactions")
	}
	baseURL := strings.TrimSpace(req.BaseURL)
	if providerType == "openai-compatible" && baseURL == "" {
		return config.ProviderConfig{}, errors.New("中转站 Base URL 不能为空")
	}
	if providerType == "gemini-interactions" && baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta/interactions"
	}
	model := strings.TrimSpace(req.Model)
	if model == "" && existing.Name == name {
		model = existing.Model
	}
	if model == "" {
		switch providerType {
		case config.ProviderTypeCodex:
			model = codexauth.DefaultModel
		case "anthropic":
			model = "claude-sonnet-4-5"
		case "gemini-interactions":
			model = "gemini-2.5-pro"
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
	if profile == config.ProviderProfileCLIProxyAPI {
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
		Disabled:       existing.Disabled,
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
		return errors.New("unsupported provider profile")
	}
}

func isProviderNameAlphaNumeric(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func isProviderNameChar(r rune) bool {
	return isProviderNameAlphaNumeric(r) || r == '.' || r == '_' || r == '-'
}

func (s *Server) newRuntimeProvider(provider config.ProviderConfig) (providers.Provider, error) {
	provider.ClientVersion = config.Version
	if provider.Type == config.ProviderTypeCodex {
		provider.CredentialStorePath = codexauth.DefaultStoreDir(s.configSnapshot().Paths.HomeDir)
	}
	if provider.Name == anthropicauth.DefaultProviderName && provider.Type == "anthropic" {
		provider.CredentialStorePath = anthropicauth.DefaultStoreDir(s.configSnapshot().Paths.HomeDir)
	}
	if s.store != nil {
		if settings, err := s.store.GetRuntimeSettings(context.Background()); err == nil {
			provider.InstallationID = settings.InstallationID
		}
	}
	adapter, err := providers.NewProvider(provider)
	if err != nil {
		return nil, err
	}
	if codexProvider, ok := adapter.(*providers.CodexProvider); ok && s.store != nil {
		codexProvider.SetAccountTelemetry(s.store)
	}
	if anthropicProvider, ok := adapter.(*providers.AnthropicProvider); ok && s.store != nil {
		anthropicProvider.SetAccountTelemetry(s.store)
	}
	return adapter, nil
}

func (s *Server) registerProvider(provider config.ProviderConfig) error {
	if provider.Disabled {
		s.unregisterProvider(provider.Name)
		return nil
	}
	adapter, err := s.newRuntimeProvider(provider)
	if err != nil {
		return err
	}
	s.registerProviderAdapter(adapter)
	return nil
}

func (s *Server) registerProviderAdapter(adapter providers.Provider) {
	if adapter == nil {
		return
	}
	if s.providers == nil {
		s.providers = providers.NewRegistry()
	}
	s.providers.Register(adapter)
}

func (s *Server) unregisterProvider(name string) {
	if s.providers != nil {
		s.providers.Unregister(name)
	}
}

func (s *Server) refreshProviderDefault(cfg config.Config) {
	if s.providers == nil {
		return
	}
	// A server constructed before all configured adapters were registered can
	// still safely switch away from a disabled/deleted default. Register only
	// enabled, validated configs; disabled entries remain unresolvable.
	for _, provider := range cfg.Providers.Instances {
		if provider.Disabled {
			s.providers.Unregister(provider.Name)
			continue
		}
		if _, ok := s.providers.Get(provider.Name); ok {
			continue
		}
		if adapter, err := s.newRuntimeProvider(provider); err == nil {
			s.providers.Register(adapter)
		}
	}
	s.providers.SetDefaultFromConfig(cfg.Agent.DefaultModel, cfg.Providers.Instances)
}

func (s *Server) ensureProviderDefaultAfterMutation(next config.Config, affectedName string) error {
	currentDefault := ""
	if s.providers != nil {
		if provider, err := s.providers.Default(); err == nil {
			currentDefault = provider.Name()
		}
	}
	configuredDefault, _ := providers.SplitModel(next.Agent.DefaultModel)
	if currentDefault != affectedName && configuredDefault != affectedName {
		return nil
	}
	for _, provider := range next.Providers.Instances {
		if provider.Disabled {
			continue
		}
		adapter, err := s.newRuntimeProvider(provider)
		if err != nil {
			continue
		}
		if providers.ConfiguredFor(adapter, provider.IsConfigured()) {
			return nil
		}
	}
	return errors.New("不能禁用或删除当前默认 Provider：没有可用且已配置的回退 Provider")
}

func (s *Server) persistProviderConfig(configPath string, cfg config.Config) (bool, error) {
	if strings.TrimSpace(configPath) == "" {
		return false, nil
	}
	if err := config.Save(configPath, cfg); err != nil {
		return false, err
	}
	return true, nil
}

func distinctModelCount(models []string) int {
	seen := make(map[string]struct{}, len(models))
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model != "" {
			seen[model] = struct{}{}
		}
	}
	return len(seen)
}

func classifyProviderTestError(err error) (errorCode, message string, reachable bool) {
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
		return "timeout", "连接 Provider 超时。", false
	}
	messageText := strings.ToLower(err.Error())
	switch {
	case strings.Contains(messageText, "401"), strings.Contains(messageText, "403"), strings.Contains(messageText, "unauthorized"), strings.Contains(messageText, "forbidden"):
		return "authentication_failed", "Provider 拒绝了凭据。", true
	case strings.Contains(messageText, "not configured"), strings.Contains(messageText, "没有可用"), strings.Contains(messageText, "credential"), strings.Contains(messageText, "api key is required"):
		return "not_configured", "Provider 凭据尚未配置。", false
	case strings.Contains(messageText, "connection refused"), strings.Contains(messageText, "no such host"), strings.Contains(messageText, "network is unreachable"), strings.Contains(messageText, "connect:"):
		return "unreachable", "无法连接 Provider。", false
	default:
		return "request_failed", "Provider 测试失败。", false
	}
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

func removeServerProvider(items []config.ProviderConfig, name string) ([]config.ProviderConfig, bool) {
	out := make([]config.ProviderConfig, 0, len(items))
	removed := false
	for _, provider := range items {
		if provider.Name == name {
			removed = true
			continue
		}
		out = append(out, provider)
	}
	return out, removed
}
