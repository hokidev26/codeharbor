package server

import (
	"bytes"
	"context"
	"strings"

	"autoto/internal/config"
	"autoto/internal/secrets"
)

type providerAPIKeyStatus struct {
	Configured bool
	Persisted  bool
	LastFive   string
	Source     string
}

func serverProviderSecretBinding(provider config.ProviderConfig) secrets.ProviderBinding {
	return secrets.ProviderBinding{
		Name:           provider.Name,
		Type:           provider.Type,
		Profile:        provider.Profile,
		BaseURL:        provider.BaseURL,
		SecretRevision: provider.SecretRevision,
	}
}

func providerSecretBindingChanged(current, next config.ProviderConfig) bool {
	return !bytes.Equal(
		secrets.ProviderBindingFingerprint(serverProviderSecretBinding(current)),
		secrets.ProviderBindingFingerprint(serverProviderSecretBinding(next)),
	)
}

func storedProviderSecretSource(source string) bool {
	source = strings.TrimSpace(source)
	return source == secrets.ProviderSecretSourceStored || source == secrets.ProviderSecretSourceStoredUnavailable
}

func nextProviderSecretRevision(current int64) int64 {
	if current < 0 {
		return 1
	}
	return current + 1
}

func (s *Server) providerAPIKeyStatus(ctx context.Context, provider config.ProviderConfig) providerAPIKeyStatus {
	source := strings.TrimSpace(provider.APIKeySource)
	switch source {
	case secrets.ProviderSecretSourceEnvironment, secrets.ProviderSecretSourceRuntime:
		configured := strings.TrimSpace(provider.APIKey) != ""
		return providerAPIKeyStatus{
			Configured: configured,
			LastFive:   secrets.SecretLastFive(strings.TrimSpace(provider.APIKey)),
			Source:     source,
		}
	case secrets.ProviderSecretSourceStored, secrets.ProviderSecretSourceStoredUnavailable:
		if s.providerVault == nil {
			return providerAPIKeyStatus{Source: secrets.ProviderSecretSourceStoredUnavailable}
		}
		metadata := s.providerVault.Metadata(ctx, serverProviderSecretBinding(provider))
		return providerAPIKeyStatus{
			Configured: metadata.Configured,
			Persisted:  metadata.Persisted,
			LastFive:   metadata.LastFive,
			Source:     metadata.Source,
		}
	}
	if strings.TrimSpace(provider.APIKey) != "" {
		return providerAPIKeyStatus{
			Configured: true,
			LastFive:   secrets.SecretLastFive(strings.TrimSpace(provider.APIKey)),
			Source:     secrets.ProviderSecretSourceRuntime,
		}
	}
	if provider.APIKeyOptional {
		return providerAPIKeyStatus{Source: secrets.ProviderSecretSourceOptional}
	}
	return providerAPIKeyStatus{Source: secrets.ProviderSecretSourceNone}
}
