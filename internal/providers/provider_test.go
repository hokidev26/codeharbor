package providers

import (
	"context"
	"testing"

	"autoto/internal/config"
)

type registryTestProvider struct{ name string }

func (p registryTestProvider) Name() string { return p.name }
func (registryTestProvider) ListModels(context.Context) ([]string, error) {
	return nil, nil
}
func (registryTestProvider) Generate(context.Context, GenerateRequest) (<-chan Event, error) {
	out := make(chan Event)
	close(out)
	return out, nil
}

func TestCapabilitiesForUnknownProviderIsEmpty(t *testing.T) {
	if got := CapabilitiesFor(registryTestProvider{name: "unknown"}); got != (Capabilities{}) {
		t.Fatalf("expected no optional capabilities, got %+v", got)
	}
}

func TestBuiltInProvidersDeclareCapabilities(t *testing.T) {
	for _, provider := range []Provider{
		NewOpenAIOfficial(config.ProviderConfig{Name: "openai", Type: "openai"}),
		NewAnthropicProvider(config.ProviderConfig{Name: "anthropic", Type: "anthropic"}),
		NewOpenAICompatible(config.ProviderConfig{Name: "relay", Type: "openai-compatible"}),
	} {
		if got := CapabilitiesFor(provider); !got.Tools || !got.Streaming || !got.ImageInput {
			t.Fatalf("expected built-in capabilities, got %+v", got)
		}
	}
}

func TestNewProviderBuildsKnownTypes(t *testing.T) {
	for _, providerType := range []string{"openai", "anthropic", "openai-compatible"} {
		provider, err := NewProvider(config.ProviderConfig{Name: providerType, Type: providerType})
		if err != nil {
			t.Fatalf("NewProvider(%q): %v", providerType, err)
		}
		if provider.Name() != providerType {
			t.Fatalf("NewProvider(%q) name = %q", providerType, provider.Name())
		}
	}
	if _, err := NewProvider(config.ProviderConfig{Type: "unknown"}); err == nil {
		t.Fatal("expected unsupported provider type error")
	}
}

func TestRegistryDefaultUsesModelPrefixThenConfigOrder(t *testing.T) {
	registry := NewRegistry()
	registry.Register(registryTestProvider{name: "first"})
	registry.Register(registryTestProvider{name: "second"})
	configs := []config.ProviderConfig{{Name: "first"}, {Name: "second"}}

	if !registry.SetDefaultFromConfig("second:model", configs) {
		t.Fatal("expected default selection")
	}
	provider, err := registry.Default()
	if err != nil || provider.Name() != "second" {
		t.Fatalf("expected prefixed default second, provider=%v err=%v", provider, err)
	}

	if !registry.SetDefaultFromConfig("unprefixed-model", configs) {
		t.Fatal("expected config-order default selection")
	}
	provider, err = registry.Default()
	if err != nil || provider.Name() != "first" {
		t.Fatalf("expected config-order default first, provider=%v err=%v", provider, err)
	}
}
