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

type providerSecretStatus struct {
	Configured bool
	Persisted  bool
	Source     string
}

func serverProviderSecretBinding(provider config.ProviderConfig) secrets.ProviderBinding {
	return secrets.ProviderBinding{
		Name:                    provider.Name,
		Type:                    provider.Type,
		Profile:                 provider.Profile,
		BaseURL:                 provider.BaseURL,
		ProxyURL:                provider.ProxyURL,
		InsecureSkipTLSVerify:   provider.InsecureSkipTLSVerify,
		SecretRevision:          provider.SecretRevision,
		TransportSecretRevision: provider.TransportSecretRevision,
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

func (s *Server) providerTransportSecretStatus(ctx context.Context, provider config.ProviderConfig, kind, source string, runtimeConfigured bool) providerSecretStatus {
	source = strings.TrimSpace(source)
	switch source {
	case secrets.ProviderSecretSourceRuntime:
		return providerSecretStatus{Configured: runtimeConfigured, Source: source}
	case secrets.ProviderSecretSourceStored, secrets.ProviderSecretSourceStoredUnavailable:
		if s.providerVault == nil {
			return providerSecretStatus{Source: secrets.ProviderSecretSourceStoredUnavailable}
		}
		metadata := s.providerVault.MetadataKind(ctx, serverProviderSecretBinding(provider), kind)
		return providerSecretStatus{Configured: metadata.Configured, Persisted: metadata.Persisted, Source: metadata.Source}
	default:
		if runtimeConfigured {
			return providerSecretStatus{Configured: true, Source: secrets.ProviderSecretSourceRuntime}
		}
		return providerSecretStatus{Source: secrets.ProviderSecretSourceNone}
	}
}

func (s *Server) providerProxyAuthStatus(ctx context.Context, provider config.ProviderConfig) providerSecretStatus {
	configured := strings.TrimSpace(provider.ProxyUsername) != "" || provider.ProxyPassword != ""
	return s.providerTransportSecretStatus(ctx, provider, secrets.ProviderProxyAuthKind, provider.ProxyAuthSource, configured)
}

func (s *Server) providerRequestHeadersStatus(ctx context.Context, provider config.ProviderConfig) providerSecretStatus {
	configured := len(provider.RequestHeaders) > 0
	for _, header := range provider.RequestHeaders {
		if strings.TrimSpace(header.Name) == "" || header.Value == "" {
			configured = false
			break
		}
	}
	return s.providerTransportSecretStatus(ctx, provider, secrets.ProviderRequestHeadersKind, provider.RequestHeadersSource, configured)
}
