package providers

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
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
}

type ToolSpec struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Schema      any    `json:"schema,omitempty"`
}

type GenerateRequest struct {
	Model        string
	SystemPrompt string
	Messages     []Message
	Tools        []ToolSpec
}

type Event struct {
	Type string
	Text string
	Done bool
}

type Provider interface {
	Name() string
	ListModels(ctx context.Context) ([]string, error)
	Generate(ctx context.Context, req GenerateRequest) (<-chan Event, error)
}

type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
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

func (r *Registry) Default() (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, name := range []string{"openai", "anthropic", "openai-compatible"} {
		if provider, ok := r.providers[name]; ok {
			return provider, nil
		}
	}
	for _, provider := range r.providers {
		return provider, nil
	}
	return nil, errors.New("no providers registered")
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
