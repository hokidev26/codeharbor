package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

type ProviderConfig struct {
	Name           string `json:"name"`
	Type           string `json:"type"`
	BaseURL        string `json:"baseUrl,omitempty"`
	APIKey         string `json:"apiKey,omitempty"`
	Model          string `json:"model"`
	MaxTokens      int64  `json:"maxTokens,omitempty"`
	APIKeyOptional bool   `json:"apiKeyOptional,omitempty"`
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
	BaseURL        string `json:"baseUrl,omitempty"`
	Model          string `json:"model"`
	MaxTokens      int64  `json:"maxTokens,omitempty"`
	Configured     bool   `json:"configured"`
	APIKeyOptional bool   `json:"apiKeyOptional,omitempty"`
}

func Default() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}
	appHome := filepath.Join(home, ".codeharbor")
	return Config{
		SchemaVersion: CurrentConfigVersion,
		Server:        ServerConfig{Host: "localhost", Port: 7788},
		Paths: PathsConfig{
			HomeDir:           appHome,
			DatabasePath:      filepath.Join(appHome, "codeharbor.db"),
			DefaultProjectDir: filepath.Join(home, "projects"),
		},
		Agent: AgentConfig{
			DefaultModel:           getenv("CODEHARBOR_DEFAULT_MODEL", "openai:gpt-4.1-mini"),
			SummaryModel:           getenv("CODEHARBOR_SUMMARY_MODEL", getenv("CODEHARBOR_DEFAULT_MODEL", "openai:gpt-4.1-mini")),
			DefaultPermissionMode:  "acceptEdits",
			DefaultStartInPlanMode: false,
			MaxTurns:               200,
			ContextTokenLimit:      getenvInt("CODEHARBOR_CONTEXT_TOKEN_LIMIT", 120000),
			FirstTokenTimeoutMs:    60000,
			MaxTransientRetries:    10,
		},
		Auth: AuthConfig{RegistrationOpen: true},
		Security: SecurityConfig{
			Exposed:             getenvBool("CODEHARBOR_EXPOSED", false),
			AccessPassword:      os.Getenv("CODEHARBOR_ACCESS_PASSWORD"),
			AllowRemoteTerminal: getenvBool("CODEHARBOR_REMOTE_TERMINAL", false),
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
			defaultCLIProxyAPIProvider(),
			{
				Name:    "openai-compatible",
				Type:    "openai-compatible",
				BaseURL: getenv("OPENAI_COMPATIBLE_BASE_URL", getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")),
				APIKey:  getenv("OPENAI_COMPATIBLE_API_KEY", os.Getenv("OPENAI_API_KEY")),
				Model:   getenv("OPENAI_COMPATIBLE_MODEL", getenv("OPENAI_MODEL", "gpt-4.1-mini")),
			},
		}},
		Backends: BackendsConfig{Instances: defaultBackendsFromEnv()},
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
	cfg, err := Default()
	if err != nil {
		return Config{}, err
	}
	path, err = ResolvePath(path)
	if err != nil {
		return Config{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if writeErr := writeDefaultConfig(path, cfg); writeErr != nil {
				return Config{}, writeErr
			}
			return cfg, nil
		}
		return Config{}, err
	}
	if len(data) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg = normalizeConfig(cfg)
	return cfg, nil
}

func normalizeConfig(cfg Config) Config {
	cfg = migrateConfig(cfg)
	applySecurityEnvOverrides(&cfg.Security)
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

func applySecurityEnvOverrides(security *SecurityConfig) {
	if value, ok := lookupBoolEnv("CODEHARBOR_EXPOSED"); ok {
		security.Exposed = value
	}
	if value := os.Getenv("CODEHARBOR_ACCESS_PASSWORD"); value != "" {
		security.AccessPassword = value
	}
	if value, ok := lookupBoolEnv("CODEHARBOR_REMOTE_TERMINAL"); ok {
		security.AllowRemoteTerminal = value
	}
}

func (c Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func (p ProviderConfig) IsConfigured() bool {
	return p.APIKey != "" || p.APIKeyOptional
}

func (p ProviderConfig) Summary() ProviderSummary {
	return ProviderSummary{
		Name:           p.Name,
		Type:           p.Type,
		BaseURL:        p.BaseURL,
		Model:          p.Model,
		MaxTokens:      p.MaxTokens,
		Configured:     p.IsConfigured(),
		APIKeyOptional: p.APIKeyOptional,
	}
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
		if p.Instances[i].Type == "" {
			p.Instances[i].Type = p.Instances[i].Name
		}
		if p.Instances[i].Name == "" {
			p.Instances[i].Name = p.Instances[i].Type
		}
		applyProviderEnvDefaults(&p.Instances[i])
	}
	return p
}

func applyProviderEnvDefaults(provider *ProviderConfig) {
	if provider.Name == "cliproxyapi" || provider.Type == "cliproxyapi" {
		applyCLIProxyAPIEnvDefaults(provider)
		return
	}
	switch provider.Type {
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

func defaultCLIProxyAPIProvider() ProviderConfig {
	provider := ProviderConfig{Name: "cliproxyapi", Type: "openai-compatible", APIKeyOptional: true}
	applyCLIProxyAPIEnvDefaults(&provider)
	return provider
}

func applyCLIProxyAPIEnvDefaults(provider *ProviderConfig) {
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

func defaultBackendsFromEnv() []BackendConfig {
	baseURL := firstEnv("CODEHARBOR_AGENT_BACKEND_URL", "OPENHANDS_AGENT_SERVER_URL", "AGENT_SERVER_URL")
	if baseURL == "" {
		return nil
	}
	return []BackendConfig{
		{
			Name:    getenv("CODEHARBOR_AGENT_BACKEND_NAME", "Local Agent Server"),
			Kind:    getenv("CODEHARBOR_AGENT_BACKEND_KIND", "local"),
			BaseURL: normalizeURL(baseURL),
			APIKey:  firstEnv("CODEHARBOR_AGENT_BACKEND_API_KEY", "OPENHANDS_SESSION_API_KEY", "AGENT_SERVER_API_KEY"),
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

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func getenvBool(key string, fallback bool) bool {
	value, ok := lookupBoolEnv(key)
	if !ok {
		return fallback
	}
	return value
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
