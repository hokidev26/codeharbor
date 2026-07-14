package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"autoto/internal/config"
)

type Message struct {
	Role    string         `json:"role"`
	Content string         `json:"content"`
	Blocks  []ContentBlock `json:"blocks,omitempty"`
}

type ContentBlock struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	MIMEType string `json:"mimeType,omitempty"`
	Data     []byte `json:"-"`
	Filename string `json:"filename,omitempty"`
	Kind     string `json:"kind,omitempty"`

	ToolUseID string          `json:"toolUseId,omitempty"`
	ToolName  string          `json:"toolName,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	Output    string          `json:"output,omitempty"`
	IsError   bool            `json:"isError,omitempty"`

	// ProviderState carries opaque adapter state (for example Gemini thought
	// signatures). It is persisted separately from public message JSON.
	ProviderState json.RawMessage `json:"-"`
}

type ToolSpec struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Schema      any    `json:"schema,omitempty"`
}

type ToolCall struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Input         json.RawMessage `json:"input,omitempty"`
	ProviderState json.RawMessage `json:"-"`
}

type Usage struct {
	InputTokens       int64 `json:"inputTokens,omitempty"`
	OutputTokens      int64 `json:"outputTokens,omitempty"`
	CachedInputTokens int64 `json:"cachedInputTokens,omitempty"`
	ReasoningTokens   int64 `json:"reasoningTokens,omitempty"`
}

type GenerateRequest struct {
	Model           string
	SystemPrompt    string
	Messages        []Message
	Tools           []ToolSpec
	ReasoningEffort string
}

type Event struct {
	Type       string
	Text       string
	ToolCall   *ToolCall
	Usage      *Usage
	StopReason string
	Done       bool
}

type Provider interface {
	Name() string
	ListModels(ctx context.Context) ([]string, error)
	Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error)
}

// Capabilities are optional provider features. Providers that do not implement
// CapabilityProvider are treated as supporting no optional features.
type Capabilities struct {
	Tools      bool `json:"tools"`
	Streaming  bool `json:"streaming"`
	ImageInput bool `json:"imageInput"`
	Reasoning  bool `json:"reasoning"`
}

type CapabilityProvider interface {
	Capabilities() Capabilities
}

func CapabilitiesFor(provider Provider) Capabilities {
	if provider, ok := provider.(CapabilityProvider); ok {
		return provider.Capabilities()
	}
	return Capabilities{}
}

// NewProvider constructs a provider adapter from a normalized provider config.
func NewProvider(cfg config.ProviderConfig) (Provider, error) {
	switch strings.TrimSpace(cfg.Type) {
	case "openai":
		return NewOpenAIOfficial(cfg), nil
	case "anthropic":
		return NewAnthropicProvider(cfg), nil
	case "openai-compatible":
		return NewOpenAICompatible(cfg), nil
	case "gemini-interactions":
		return NewGeminiInteractions(cfg), nil
	default:
		return nil, fmt.Errorf("unsupported provider type %q", cfg.Type)
	}
}

type Registry struct {
	mu          sync.RWMutex
	providers   map[string]Provider
	defaultName string
}

func NewRegistry() *Registry {
	return &Registry{providers: make(map[string]Provider)}
}

func (r *Registry) Register(provider Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[provider.Name()] = provider
}

func (r *Registry) Get(name string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	provider, ok := r.providers[name]
	return provider, ok
}

func (r *Registry) Resolve(model string) (Provider, string, error) {
	providerName, modelName := SplitModel(model)
	if providerName != "" {
		provider, ok := r.Get(providerName)
		if !ok {
			return nil, "", fmt.Errorf("provider %q is not registered", providerName)
		}
		return provider, modelName, nil
	}
	provider, err := r.Default()
	if err != nil {
		return nil, "", err
	}
	return provider, modelName, nil
}

func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.providers))
	for name := range r.providers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// SetDefault explicitly selects the provider used for unprefixed model names.
func (r *Registry) SetDefault(name string) error {
	name = strings.TrimSpace(name)
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.providers[name]; !ok {
		return fmt.Errorf("provider %q is not registered", name)
	}
	r.defaultName = name
	return nil
}

// SetDefaultFromConfig selects a default deterministically: first the provider
// named by the default model prefix, then the first registered provider in
// configuration order. It returns false when no configured provider is registered.
func (r *Registry) SetDefaultFromConfig(defaultModel string, configs []config.ProviderConfig) bool {
	preferred, _ := SplitModel(defaultModel)
	candidates := make([]string, 0, len(configs)+1)
	if preferred != "" {
		candidates = append(candidates, preferred)
	}
	for _, cfg := range configs {
		if name := strings.TrimSpace(cfg.Name); name != "" && name != preferred {
			candidates = append(candidates, name)
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, name := range candidates {
		if _, ok := r.providers[name]; ok {
			r.defaultName = name
			return true
		}
	}
	r.defaultName = ""
	return false
}

func (r *Registry) Default() (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.defaultName == "" {
		return nil, errors.New("no default provider configured")
	}
	provider, ok := r.providers[r.defaultName]
	if !ok {
		return nil, fmt.Errorf("default provider %q is not registered", r.defaultName)
	}
	return provider, nil
}

func SplitModel(model string) (providerName string, modelName string) {
	model = strings.TrimSpace(model)
	parts := strings.SplitN(model, ":", 2)
	if len(parts) != 2 {
		return "", model
	}
	providerName = strings.TrimSpace(parts[0])
	modelName = strings.TrimSpace(parts[1])
	if providerName == "" || modelName == "" {
		return "", model
	}
	return providerName, modelName
}
