package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"autoto/internal/compat"
)

const Version = "0.1.0-dev"
const CurrentConfigVersion = 1

type Config struct {
	SchemaVersion int             `json:"version"`
	Server        ServerConfig    `json:"server"`
	Paths         PathsConfig     `json:"paths"`
	Agent         AgentConfig     `json:"agent"`
	Auth          AuthConfig      `json:"auth"`
	Security      SecurityConfig  `json:"security"`
	Providers     ProvidersConfig `json:"providers"`
	Backends      BackendsConfig  `json:"backends"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type PathsConfig struct {
	HomeDir           string `json:"homeDir"`
	DatabasePath      string `json:"databasePath"`
	DefaultProjectDir string `json:"defaultProjectDir"`
}

type AgentConfig struct {
	DefaultModel           string `json:"defaultModel"`
	SummaryModel           string `json:"summaryModel"`
	DefaultPermissionMode  string `json:"defaultPermissionMode"`
	DefaultStartInPlanMode bool   `json:"defaultStartInPlanMode"`
	MaxTurns               int    `json:"maxTurns"`
	ContextTokenLimit      int    `json:"contextTokenLimit"`
	FirstTokenTimeoutMs    int    `json:"firstTokenTimeoutMs"`
	MaxTransientRetries    int    `json:"maxTransientRetries"`
}

type AuthConfig struct {
	JWTSecret        string `json:"jwtSecret"`
	RegistrationOpen bool   `json:"registrationOpen"`
}

type SecurityConfig struct {
	Exposed             bool   `json:"exposed"`
	AccessPassword      string `json:"accessPassword,omitempty"`
	AllowRemoteTerminal bool   `json:"allowRemoteTerminal,omitempty"`
}

type ProvidersConfig struct {
	Instances        []ProviderConfig        `json:"instances"`
	OpenAICompatible *OpenAICompatibleConfig `json:"openaiCompatible,omitempty"`
}

const ProviderProfileCLIProxyAPI = "cliproxyapi"
const ProviderTypeCodex = "codex"

const (
	ProviderOriginBuiltin = "builtin"
	ProviderOriginCustom  = "custom"
)

type ProviderConfig struct {
	Name           string `json:"name"`
	Type           string `json:"type"`
	Profile        string `json:"profile,omitempty"`
	BaseURL        string `json:"baseUrl,omitempty"`
	APIKey         string `json:"apiKey,omitempty"`
	Model          string `json:"model"`
	MaxTokens      int64  `json:"maxTokens,omitempty"`
	APIKeyOptional bool   `json:"apiKeyOptional,omitempty"`
	// Disabled is persisted instead of Enabled so configs written before this
	// field existed remain enabled after an upgrade.
	Disabled bool `json:"disabled,omitempty"`

	ClientVersion                  string `json:"-"`
	InstallationID                 string `json:"-"`
	CredentialStorePath            string `json:"-"`
	CodexAllowInsecureTestEndpoint bool   `json:"-"`
	CodexRefreshURLForTest         string `json:"-"`
	CodexUsageURL                  string `json:"-"`
}

type OpenAICompatibleConfig = ProviderConfig

type BackendsConfig struct {
	Instances []BackendConfig `json:"instances"`
}

type BackendConfig struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey,omitempty"`
	Active  bool   `json:"active,omitempty"`
}

type ProviderSummary struct {
	Name           string `json:"name"`
	Type           string `json:"type"`
	Profile        string `json:"profile,omitempty"`
	BaseURL        string `json:"baseUrl,omitempty"`
	Model          string `json:"model"`
	MaxTokens      int64  `json:"maxTokens,omitempty"`
	Configured     bool   `json:"configured"`
	APIKeyOptional bool   `json:"apiKeyOptional,omitempty"`
	Enabled        bool   `json:"enabled"`
	Origin         string `json:"origin"`
}

func Default() (Config, error) {
	cfg, _, err := DefaultWithReport()
	return cfg, err
}

func DefaultWithReport() (Config, compat.Report, error) {
	var report compat.Report
	cfg, err := defaultWithReport(&report)
	return cfg, report, err
}

func defaultWithReport(report *compat.Report) (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}
	appHome := filepath.Join(home, ".autoto")
	defaultModel := firstEnvFallback(report, "AUTOTO_DEFAULT_MODEL", "CODEHARBOR_DEFAULT_MODEL")
	if defaultModel == "" {
		defaultModel = "openai:gpt-4.1-mini"
	}
	summaryModel := firstEnvFallback(report, "AUTOTO_SUMMARY_MODEL", "CODEHARBOR_SUMMARY_MODEL")
	if summaryModel == "" {
		summaryModel = defaultModel
	}
	return Config{
		SchemaVersion: CurrentConfigVersion,
		Server:        ServerConfig{Host: "localhost", Port: 7788},
		Paths: PathsConfig{
			HomeDir:           appHome,
			DatabasePath:      filepath.Join(appHome, "autoto.db"),
			DefaultProjectDir: filepath.Join(home, "projects"),
		},
		Agent: AgentConfig{
			DefaultModel:           defaultModel,
			SummaryModel:           summaryModel,
			DefaultPermissionMode:  "acceptEdits",
			DefaultStartInPlanMode: false,
			MaxTurns:               200,
			ContextTokenLimit:      getenvIntFallbackReported(report, []string{"AUTOTO_CONTEXT_TOKEN_LIMIT", "CODEHARBOR_CONTEXT_TOKEN_LIMIT"}, 120000),
			FirstTokenTimeoutMs:    60000,
			MaxTransientRetries:    10,
		},
		Auth: AuthConfig{RegistrationOpen: true},
		Security: SecurityConfig{
			Exposed:             getenvBoolFallbackReported(report, []string{"AUTOTO_EXPOSED", "CODEHARBOR_EXPOSED"}, false),
			AccessPassword:      firstEnvFallback(report, "AUTOTO_ACCESS_PASSWORD", "CODEHARBOR_ACCESS_PASSWORD"),
			AllowRemoteTerminal: getenvBoolFallbackReported(report, []string{"AUTOTO_REMOTE_TERMINAL", "CODEHARBOR_REMOTE_TERMINAL"}, false),
		},
		Providers: ProvidersConfig{Instances: []ProviderConfig{
			{
				Name:   "openai",
				Type:   "openai",
				APIKey: os.Getenv("OPENAI_API_KEY"),
				Model:  getenv("OPENAI_MODEL", "gpt-4.1-mini"),
			},
			{
				Name:      "anthropic",
				Type:      "anthropic",
				APIKey:    os.Getenv("ANTHROPIC_API_KEY"),
				Model:     getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
				MaxTokens: 4096,
			},
			defaultCodexProvider(),
			{
				Name:    "openai-compatible",
				Type:    "openai-compatible",
				BaseURL: getenv("OPENAI_COMPATIBLE_BASE_URL", getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")),
				APIKey:  getenv("OPENAI_COMPATIBLE_API_KEY", os.Getenv("OPENAI_API_KEY")),
				Model:   getenv("OPENAI_COMPATIBLE_MODEL", getenv("OPENAI_MODEL", "gpt-4.1-mini")),
			},
		}},
		Backends: BackendsConfig{Instances: defaultBackendsFromEnv(report)},
	}, nil
}

func ResolvePath(path string) (string, error) {
	if strings.TrimSpace(path) != "" {
		return path, nil
	}
	cfg, err := Default()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg.Paths.HomeDir, "config.json"), nil
}

func Load(path string) (Config, error) {
	cfg, _, err := LoadWithReport(path)
	return cfg, err
}

func LoadWithReport(path string) (Config, compat.Report, error) {
	var report compat.Report
	cfg, err := defaultWithReport(&report)
	if err != nil {
		return Config{}, report, err
	}
	path, err = ResolvePath(path)
	if err != nil {
		return Config{}, report, err
	}
	legacyPath, err := legacyConfigPath()
	if err != nil {
		return Config{}, report, err
	}
	explicitLegacyPath := filepath.Clean(path) == filepath.Clean(legacyPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Config{}, report, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if isCanonicalConfigPath(path, cfg) {
				if copied, copyErr := copyLegacyConfig(legacyPath, path); copyErr != nil {
					return Config{}, report, copyErr
				} else if copied {
					report.Add(legacyConfigUsage("copied"))
					data, err = os.ReadFile(path)
					if err != nil {
						return Config{}, report, err
					}
					goto decode
				}
			}
			if writeErr := writeDefaultConfig(path, cfg); writeErr != nil {
				return Config{}, report, writeErr
			}
			if explicitLegacyPath {
				report.Add(legacyConfigUsage("loaded"))
			}
			return cfg, report, nil
		}
		return Config{}, report, err
	}

decode:
	filterOverriddenDefaultUsages(&report, data)
	if len(data) == 0 {
		if explicitLegacyPath {
			report.Add(legacyConfigUsage("loaded"))
		}
		return cfg, report, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, report, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg = normalizeConfigWithReport(cfg, &report)
	if explicitLegacyPath {
		report.Add(legacyConfigUsage("loaded"))
	}
	return cfg, report, nil
}

func isCanonicalConfigPath(path string, cfg Config) bool {
	canonical := filepath.Join(cfg.Paths.HomeDir, "config.json")
	return filepath.Clean(path) == filepath.Clean(canonical)
}

func legacyConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codeharbor", "config.json"), nil
}

func legacyConfigUsage(operation string) compat.Usage {
	return compat.Usage{
		Key:         "config:" + operation + ":~/.codeharbor/config.json",
		Legacy:      "~/.codeharbor/config.json",
		Replacement: "~/.autoto/config.json",
		Kind:        operation,
	}
}

func filterOverriddenDefaultUsages(report *compat.Report, data []byte) {
	if report == nil || len(data) == 0 {
		return
	}
	var raw struct {
		Agent    map[string]json.RawMessage `json:"agent"`
		Backends map[string]json.RawMessage `json:"backends"`
	}
	if json.Unmarshal(data, &raw) != nil {
		return
	}
	remove := map[string]bool{}
	_, hasDefaultModel := raw.Agent["defaultModel"]
	_, hasSummaryModel := raw.Agent["summaryModel"]
	if hasDefaultModel && (hasSummaryModel || os.Getenv("AUTOTO_SUMMARY_MODEL") != "" || os.Getenv("CODEHARBOR_SUMMARY_MODEL") != "") {
		remove[envUsageKey("CODEHARBOR_DEFAULT_MODEL")] = true
	}
	if hasSummaryModel {
		remove[envUsageKey("CODEHARBOR_SUMMARY_MODEL")] = true
	}
	if _, ok := raw.Agent["contextTokenLimit"]; ok {
		remove[envUsageKey("CODEHARBOR_CONTEXT_TOKEN_LIMIT")] = true
	}
	if _, ok := raw.Backends["instances"]; ok {
		for _, name := range []string{
			"CODEHARBOR_AGENT_BACKEND_URL",
			"CODEHARBOR_AGENT_BACKEND_NAME",
			"CODEHARBOR_AGENT_BACKEND_KIND",
			"CODEHARBOR_AGENT_BACKEND_API_KEY",
		} {
			remove[envUsageKey(name)] = true
		}
	}
	if len(remove) == 0 {
		return
	}
	filtered := report.Usages[:0]
	for _, usage := range report.Usages {
		if !remove[usage.Key] {
			filtered = append(filtered, usage)
		}
	}
	report.Usages = filtered
}

func copyLegacyConfig(sourcePath, destinationPath string) (bool, error) {
	linkInfo, err := os.Lstat(sourcePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	if !linkInfo.Mode().IsRegular() {
		return false, fmt.Errorf("legacy config %s is not a regular file", sourcePath)
	}

	source, err := os.Open(sourcePath)
	if err != nil {
		return false, err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || !os.SameFile(linkInfo, info) {
		return false, fmt.Errorf("legacy config %s changed while opening", sourcePath)
	}

	destination, err := os.OpenFile(destinationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return true, nil
		}
		return false, err
	}
	complete := false
	defer func() {
		_ = destination.Close()
		if !complete {
			_ = os.Remove(destinationPath)
		}
	}()
	if _, err := io.Copy(destination, source); err != nil {
		return false, err
	}
	if err := destination.Sync(); err != nil {
		return false, err
	}
	if err := destination.Close(); err != nil {
		return false, err
	}
	complete = true
	return true, nil
}

func normalizeConfig(cfg Config) Config {
	return normalizeConfigWithReport(cfg, nil)
}

func normalizeConfigWithReport(cfg Config, report *compat.Report) Config {
	cfg = migrateConfig(cfg)
	applySecurityEnvOverrides(&cfg.Security, report)
	cfg.Providers = normalizeProviders(cfg.Providers)
	cfg.Backends = normalizeBackends(cfg.Backends)
	return cfg
}

func migrateConfig(cfg Config) Config {
	if cfg.SchemaVersion <= 0 {
		cfg.SchemaVersion = CurrentConfigVersion
	}
	return cfg
}

func applySecurityEnvOverrides(security *SecurityConfig, report *compat.Report) {
	if value, ok := lookupBoolEnvFallbackReported(report, "AUTOTO_EXPOSED", "CODEHARBOR_EXPOSED"); ok {
		security.Exposed = value
	}
	if value := firstEnvFallback(report, "AUTOTO_ACCESS_PASSWORD", "CODEHARBOR_ACCESS_PASSWORD"); value != "" {
		security.AccessPassword = value
	}
	if value, ok := lookupBoolEnvFallbackReported(report, "AUTOTO_REMOTE_TERMINAL", "CODEHARBOR_REMOTE_TERMINAL"); ok {
		security.AllowRemoteTerminal = value
	}
}

func (c Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func (p ProviderConfig) IsConfigured() bool {
	if p.Type == ProviderTypeCodex {
		return false
	}
	return p.APIKey != "" || p.APIKeyOptional
}

func (p ProviderConfig) Summary() ProviderSummary {
	return ProviderSummary{
		Name:           p.Name,
		Type:           p.Type,
		Profile:        p.Profile,
		BaseURL:        p.BaseURL,
		Model:          p.Model,
		MaxTokens:      p.MaxTokens,
		Configured:     p.IsConfigured(),
		APIKeyOptional: p.APIKeyOptional,
		Enabled:        !p.Disabled,
		Origin:         ProviderOriginForName(p.Name),
	}
}

// ProviderOriginForName determines provider ownership on the server. API
// clients never supply this value, so a custom provider cannot self-identify
// as built in to bypass lifecycle restrictions.
func ProviderOriginForName(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "openai", "anthropic", ProviderTypeCodex, "ollama", "openai-compatible", ProviderProfileCLIProxyAPI:
		return ProviderOriginBuiltin
	default:
		return ProviderOriginCustom
	}
}

func IsBuiltinProviderName(name string) bool {
	return ProviderOriginForName(name) == ProviderOriginBuiltin
}

func (p ProvidersConfig) Summaries() []ProviderSummary {
	providers := normalizeProviders(p).Instances
	out := make([]ProviderSummary, 0, len(providers))
	for _, provider := range providers {
		out = append(out, provider.Summary())
	}
	return out
}

func normalizeProviders(p ProvidersConfig) ProvidersConfig {
	if p.OpenAICompatible != nil {
		legacy := *p.OpenAICompatible
		if legacy.Name == "" {
			legacy.Name = "openai-compatible"
		}
		if legacy.Type == "" {
			legacy.Type = "openai-compatible"
		}
		p.Instances = upsertProvider(p.Instances, legacy)
		p.OpenAICompatible = nil
	}
	for i := range p.Instances {
		provider := &p.Instances[i]
		provider.Name = strings.TrimSpace(provider.Name)
		provider.Type = strings.TrimSpace(provider.Type)
		provider.Profile = strings.TrimSpace(provider.Profile)
		if provider.Type == "" {
			provider.Type = provider.Name
		}
		if provider.Name == "" {
			provider.Name = provider.Type
		}
		if provider.Profile == "" {
			provider.Profile = legacyProviderProfile(provider.Name)
		}
		applyProviderEnvDefaults(provider)
	}
	return p
}

// legacyProviderProfile is the single compatibility boundary for historic provider names.
func legacyProviderProfile(name string) string {
	if strings.EqualFold(strings.TrimSpace(name), ProviderProfileCLIProxyAPI) {
		return ProviderProfileCLIProxyAPI
	}
	return ""
}

// NormalizeProviderConfig applies the same compatibility defaults used when loading config.
func NormalizeProviderConfig(provider ProviderConfig) ProviderConfig {
	return normalizeProviders(ProvidersConfig{Instances: []ProviderConfig{provider}}).Instances[0]
}

func applyProviderEnvDefaults(provider *ProviderConfig) {
	if provider.Profile == ProviderProfileCLIProxyAPI {
		applyCLIProxyAPIEnvDefaults(provider)
		return
	}
	if provider.Name == "groq" {
		applyGroqEnvDefaults(provider)
		return
	}
	switch provider.Type {
	case ProviderTypeCodex:
		provider.Name = "codex"
		if provider.BaseURL == "" {
			provider.BaseURL = "https://chatgpt.com/backend-api/codex"
		}
		if provider.Model == "" {
			provider.Model = getenv("CODEX_MODEL", "gpt-5.5")
		}
	case "openai":
		if provider.APIKey == "" {
			provider.APIKey = os.Getenv("OPENAI_API_KEY")
		}
		if provider.Model == "" {
			provider.Model = getenv("OPENAI_MODEL", "gpt-4.1-mini")
		}
	case "anthropic":
		if provider.APIKey == "" {
			provider.APIKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if provider.Model == "" {
			provider.Model = getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
		}
		if provider.MaxTokens <= 0 {
			provider.MaxTokens = 4096
		}
	case "openai-compatible":
		if provider.BaseURL == "" {
			provider.BaseURL = getenv("OPENAI_COMPATIBLE_BASE_URL", getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"))
		}
		if provider.APIKey == "" {
			provider.APIKey = getenv("OPENAI_COMPATIBLE_API_KEY", os.Getenv("OPENAI_API_KEY"))
		}
		if provider.Model == "" {
			provider.Model = getenv("OPENAI_COMPATIBLE_MODEL", getenv("OPENAI_MODEL", "gpt-4.1-mini"))
		}
	}
}

func defaultCodexProvider() ProviderConfig {
	provider := ProviderConfig{Name: "codex", Type: ProviderTypeCodex}
	applyProviderEnvDefaults(&provider)
	return provider
}

func applyGroqEnvDefaults(provider *ProviderConfig) {
	provider.Name = "groq"
	provider.Type = "openai-compatible"
	if provider.BaseURL == "" {
		provider.BaseURL = "https://api.groq.com/openai/v1"
	}
	if provider.APIKey == "" {
		provider.APIKey = os.Getenv("GROQ_API_KEY")
	}
	if provider.Model == "" {
		provider.Model = getenv("GROQ_MODEL", "openai/gpt-oss-20b")
	}
}

func applyCLIProxyAPIEnvDefaults(provider *ProviderConfig) {
	provider.Profile = ProviderProfileCLIProxyAPI
	if provider.Name == "" {
		provider.Name = "cliproxyapi"
	}
	provider.Type = "openai-compatible"
	provider.APIKeyOptional = true
	if provider.BaseURL == "" {
		provider.BaseURL = firstEnv("CLIPROXYAPI_BASE_URL", "CLIPROXY_BASE_URL", "CLI_PROXY_API_BASE_URL", "CPA_BASE_URL")
	}
	if provider.BaseURL == "" {
		provider.BaseURL = "http://127.0.0.1:8317/v1"
	}
	if provider.APIKey == "" {
		provider.APIKey = firstEnv("CLIPROXYAPI_API_KEY", "CLIPROXY_API_KEY", "CLI_PROXY_API_KEY", "CPA_API_KEY")
	}
	if provider.Model == "" {
		provider.Model = firstEnv("CLIPROXYAPI_MODEL", "CLIPROXY_MODEL", "CLI_PROXY_MODEL", "CPA_MODEL")
	}
	if provider.Model == "" {
		provider.Model = "gpt-5.5"
	}
}

func upsertProvider(providers []ProviderConfig, provider ProviderConfig) []ProviderConfig {
	for i, existing := range providers {
		if existing.Name == provider.Name {
			providers[i] = provider
			return providers
		}
	}
	return append(providers, provider)
}

func Save(path string, cfg Config) error {
	path, err := ResolvePath(path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeDefaultConfig(path, cfg)
}

func writeDefaultConfig(path string, cfg Config) error {
	data, err := json.MarshalIndent(sanitizeConfigForDisk(cfg), "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func sanitizeConfigForDisk(cfg Config) Config {
	cfg = normalizeConfig(cfg)
	cfg.Auth.JWTSecret = ""
	cfg.Security.AccessPassword = ""
	if len(cfg.Providers.Instances) > 0 {
		cfg.Providers.Instances = append([]ProviderConfig(nil), cfg.Providers.Instances...)
		for i := range cfg.Providers.Instances {
			cfg.Providers.Instances[i].APIKey = ""
		}
	}
	if cfg.Providers.OpenAICompatible != nil {
		legacy := *cfg.Providers.OpenAICompatible
		legacy.APIKey = ""
		cfg.Providers.OpenAICompatible = &legacy
	}
	if len(cfg.Backends.Instances) > 0 {
		cfg.Backends.Instances = append([]BackendConfig(nil), cfg.Backends.Instances...)
		for i := range cfg.Backends.Instances {
			cfg.Backends.Instances[i].APIKey = ""
		}
	}
	return cfg
}

func defaultBackendsFromEnv(report *compat.Report) []BackendConfig {
	baseURL := firstEnvFallback(report, "AUTOTO_AGENT_BACKEND_URL", "CODEHARBOR_AGENT_BACKEND_URL", "OPENHANDS_AGENT_SERVER_URL", "AGENT_SERVER_URL")
	if baseURL == "" {
		return nil
	}
	name := firstEnvFallback(report, "AUTOTO_AGENT_BACKEND_NAME", "CODEHARBOR_AGENT_BACKEND_NAME")
	if name == "" {
		name = "Local Agent Server"
	}
	kind := firstEnvFallback(report, "AUTOTO_AGENT_BACKEND_KIND", "CODEHARBOR_AGENT_BACKEND_KIND")
	if kind == "" {
		kind = "local"
	}
	return []BackendConfig{
		{
			Name:    name,
			Kind:    kind,
			BaseURL: normalizeURL(baseURL),
			APIKey:  firstEnvFallback(report, "AUTOTO_AGENT_BACKEND_API_KEY", "CODEHARBOR_AGENT_BACKEND_API_KEY", "OPENHANDS_SESSION_API_KEY", "AGENT_SERVER_API_KEY"),
			Active:  true,
		},
	}
}

func normalizeBackends(backends BackendsConfig) BackendsConfig {
	for i := range backends.Instances {
		backend := &backends.Instances[i]
		backend.Name = strings.TrimSpace(backend.Name)
		backend.Kind = strings.TrimSpace(backend.Kind)
		if backend.Kind == "" {
			backend.Kind = "local"
		}
		if backend.Kind != "cloud" {
			backend.Kind = "local"
		}
		backend.BaseURL = normalizeURL(backend.BaseURL)
	}
	return backends
}

func normalizeURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimRight(trimmed, "/")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return ""
}

func firstEnvFallback(report *compat.Report, canonical string, fallbackKeys ...string) string {
	if value := os.Getenv(canonical); value != "" {
		return value
	}
	for _, key := range fallbackKeys {
		if value := os.Getenv(key); value != "" {
			reportLegacyEnv(report, key, canonical)
			return value
		}
	}
	return ""
}

func envUsageKey(name string) string {
	return "env:" + name
}

func reportLegacyEnv(report *compat.Report, legacy, replacement string) {
	if report == nil || !strings.HasPrefix(legacy, "CODEHARBOR_") {
		return
	}
	report.Add(compat.Usage{
		Key:         envUsageKey(legacy),
		Legacy:      legacy,
		Replacement: replacement,
		Kind:        "environment-variable",
	})
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	return getenvIntFallback([]string{key}, fallback)
}

func getenvIntFallback(keys []string, fallback int) int {
	return getenvIntFallbackReported(nil, keys, fallback)
}

func getenvIntFallbackReported(report *compat.Report, keys []string, fallback int) int {
	for i, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return fallback
		}
		if i > 0 && len(keys) > 0 {
			reportLegacyEnv(report, key, keys[0])
		}
		return parsed
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	return getenvBoolFallback([]string{key}, fallback)
}

func getenvBoolFallback(keys []string, fallback bool) bool {
	return getenvBoolFallbackReported(nil, keys, fallback)
}

func getenvBoolFallbackReported(report *compat.Report, keys []string, fallback bool) bool {
	value, ok := lookupBoolEnvFallbackReported(report, keys...)
	if !ok {
		return fallback
	}
	return value
}

func lookupBoolEnvFallback(keys ...string) (bool, bool) {
	return lookupBoolEnvFallbackReported(nil, keys...)
}

func lookupBoolEnvFallbackReported(report *compat.Report, keys ...string) (bool, bool) {
	for i, key := range keys {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			continue
		}
		value, ok := lookupBoolEnv(key)
		if ok && i > 0 && len(keys) > 0 {
			reportLegacyEnv(report, key, keys[0])
		}
		return value, ok
	}
	return false, false
}

func lookupBoolEnv(key string) (bool, bool) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return false, false
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, false
	}
	return parsed, true
}
