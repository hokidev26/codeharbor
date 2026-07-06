package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const Version = "0.1.0-dev"

type Config struct {
	Server    ServerConfig    `json:"server"`
	Paths     PathsConfig     `json:"paths"`
	Agent     AgentConfig     `json:"agent"`
	Auth      AuthConfig      `json:"auth"`
	Providers ProvidersConfig `json:"providers"`
	Backends  BackendsConfig  `json:"backends"`
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
	FirstTokenTimeoutMs    int    `json:"firstTokenTimeoutMs"`
	MaxTransientRetries    int    `json:"maxTransientRetries"`
}

type AuthConfig struct {
	JWTSecret        string `json:"jwtSecret"`
	RegistrationOpen bool   `json:"registrationOpen"`
}

type ProvidersConfig struct {
	Instances        []ProviderConfig        `json:"instances"`
	OpenAICompatible *OpenAICompatibleConfig `json:"openaiCompatible,omitempty"`
}

type ProviderConfig struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	BaseURL   string `json:"baseUrl,omitempty"`
	APIKey    string `json:"apiKey,omitempty"`
	Model     string `json:"model"`
	MaxTokens int64  `json:"maxTokens,omitempty"`
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
	Name       string `json:"name"`
	Type       string `json:"type"`
	BaseURL    string `json:"baseUrl,omitempty"`
	Model      string `json:"model"`
	MaxTokens  int64  `json:"maxTokens,omitempty"`
	Configured bool   `json:"configured"`
}

func Default() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}
	appHome := filepath.Join(home, ".codeharbor")
	return Config{
		Server: ServerConfig{Host: "localhost", Port: 7788},
		Paths: PathsConfig{
			HomeDir:           appHome,
			DatabasePath:      filepath.Join(appHome, "codeharbor.db"),
			DefaultProjectDir: filepath.Join(home, "projects"),
		},
		Agent: AgentConfig{
			DefaultModel:           "openai:gpt-4.1-mini",
			SummaryModel:           "openai:gpt-4.1-mini",
			DefaultPermissionMode:  "acceptEdits",
			DefaultStartInPlanMode: false,
			MaxTurns:               200,
			FirstTokenTimeoutMs:    60000,
			MaxTransientRetries:    10,
		},
		Auth: AuthConfig{RegistrationOpen: true},
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

func Load(path string) (Config, error) {
	cfg, err := Default()
	if err != nil {
		return Config{}, err
	}
	if path == "" {
		path = filepath.Join(cfg.Paths.HomeDir, "config.json")
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
	cfg.Providers = normalizeProviders(cfg.Providers)
	cfg.Backends = normalizeBackends(cfg.Backends)
	return cfg, nil
}

func (c Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func (p ProviderConfig) IsConfigured() bool {
	return p.APIKey != ""
}

func (p ProviderConfig) Summary() ProviderSummary {
	return ProviderSummary{
		Name:       p.Name,
		Type:       p.Type,
		BaseURL:    p.BaseURL,
		Model:      p.Model,
		MaxTokens:  p.MaxTokens,
		Configured: p.IsConfigured(),
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

func upsertProvider(providers []ProviderConfig, provider ProviderConfig) []ProviderConfig {
	for i, existing := range providers {
		if existing.Name == provider.Name {
			providers[i] = provider
			return providers
		}
	}
	return append(providers, provider)
}

func writeDefaultConfig(path string, cfg Config) error {
	data, err := json.MarshalIndent(sanitizeConfigForDisk(cfg), "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func sanitizeConfigForDisk(cfg Config) Config {
	cfg.Auth.JWTSecret = ""
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
