package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"autoto/internal/config"
	"autoto/internal/secrets"
)

func providerSecretBinding(provider config.ProviderConfig) secrets.ProviderBinding {
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

func providerSecretBindings(cfg config.Config) map[string]secrets.ProviderBinding {
	bindings := make(map[string]secrets.ProviderBinding, len(cfg.Providers.Instances))
	for _, provider := range cfg.Providers.Instances {
		bindings[provider.Name] = providerSecretBinding(provider)
	}
	return bindings
}

type providerProxyAuthPayload struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func hydrateProviderTransportSecrets(ctx context.Context, provider config.ProviderConfig, vault *secrets.ProviderVault) (config.ProviderConfig, []error) {
	var warnings []error
	binding := providerSecretBinding(provider)
	if strings.TrimSpace(provider.ProxyURL) != "" {
		secret, _, err := vault.ResolveKind(ctx, binding, secrets.ProviderProxyAuthKind)
		switch {
		case err == nil:
			var auth providerProxyAuthPayload
			if json.Unmarshal([]byte(secret), &auth) != nil {
				provider.ProxyAuthSource = secrets.ProviderSecretSourceStoredUnavailable
				warnings = append(warnings, fmt.Errorf("load stored provider proxy authentication %s: invalid encrypted payload", provider.Name))
			} else {
				provider.ProxyUsername = auth.Username
				provider.ProxyPassword = auth.Password
				provider.ProxyAuthSource = secrets.ProviderSecretSourceStored
			}
		case errors.Is(err, secrets.ErrProviderSecretNotConfigured):
			provider.ProxyAuthSource = secrets.ProviderSecretSourceNone
		default:
			provider.ProxyAuthSource = secrets.ProviderSecretSourceStoredUnavailable
			warnings = append(warnings, fmt.Errorf("load stored provider proxy authentication %s: %w", provider.Name, err))
		}
	} else {
		provider.ProxyUsername = ""
		provider.ProxyPassword = ""
		provider.ProxyAuthSource = secrets.ProviderSecretSourceNone
	}

	if len(provider.RequestHeaders) > 0 {
		secret, _, err := vault.ResolveKind(ctx, binding, secrets.ProviderRequestHeadersKind)
		switch {
		case err == nil:
			values := map[string]string{}
			if json.Unmarshal([]byte(secret), &values) != nil {
				provider.RequestHeadersSource = secrets.ProviderSecretSourceStoredUnavailable
				warnings = append(warnings, fmt.Errorf("load stored provider request headers %s: invalid encrypted payload", provider.Name))
				break
			}
			canonical := make(map[string]string, len(values))
			for name, value := range values {
				canonical[strings.ToLower(strings.TrimSpace(name))] = value
			}
			complete := true
			for i := range provider.RequestHeaders {
				value, ok := canonical[strings.ToLower(strings.TrimSpace(provider.RequestHeaders[i].Name))]
				if !ok || value == "" {
					complete = false
					continue
				}
				provider.RequestHeaders[i].Value = value
			}
			if complete {
				provider.RequestHeadersSource = secrets.ProviderSecretSourceStored
			} else {
				provider.RequestHeadersSource = secrets.ProviderSecretSourceStoredUnavailable
				warnings = append(warnings, fmt.Errorf("load stored provider request headers %s: encrypted values do not match configured names", provider.Name))
			}
		case errors.Is(err, secrets.ErrProviderSecretNotConfigured):
			provider.RequestHeadersSource = secrets.ProviderSecretSourceNone
		default:
			provider.RequestHeadersSource = secrets.ProviderSecretSourceStoredUnavailable
			warnings = append(warnings, fmt.Errorf("load stored provider request headers %s: %w", provider.Name, err))
		}
	} else {
		provider.RequestHeadersSource = secrets.ProviderSecretSourceNone
	}
	return provider, warnings
}

func prepareLegacyProviderTransportSecrets(ctx context.Context, provider config.ProviderConfig, input config.ProviderTransportSecretInput, vault *secrets.ProviderVault) (config.ProviderConfig, []string, error) {
	if vault == nil || !input.LegacyPresent() {
		return provider, nil, nil
	}
	needsMigration := false
	if input.LegacyProxyAuthPresent && provider.ProxyAuthSource != secrets.ProviderSecretSourceStored && provider.ProxyAuthSource != secrets.ProviderSecretSourceStoredUnavailable {
		provider.ProxyUsername = input.ProxyUsername
		provider.ProxyPassword = input.ProxyPassword
		provider.ProxyAuthSource = secrets.ProviderSecretSourceRuntime
		needsMigration = true
	}
	if input.LegacyRequestHeadersPresent && provider.RequestHeadersSource != secrets.ProviderSecretSourceStored && provider.RequestHeadersSource != secrets.ProviderSecretSourceStoredUnavailable {
		provider.RequestHeaders = append([]config.ProviderRequestHeader(nil), input.RequestHeaders...)
		provider.RequestHeadersSource = secrets.ProviderSecretSourceRuntime
		needsMigration = true
	}
	if provider.ProxyAuthSource == secrets.ProviderSecretSourceStoredUnavailable || provider.RequestHeadersSource == secrets.ProviderSecretSourceStoredUnavailable {
		return provider, nil, errors.New("existing encrypted provider transport secret is unavailable")
	}
	if !needsMigration {
		return provider, nil, nil
	}

	provider.TransportSecretRevision++
	binding := providerSecretBinding(provider)
	prepared := make([]string, 0, 2)
	prepare := func(kind, value string, configured bool) error {
		var err error
		if configured {
			_, err = vault.PrepareSetKind(ctx, binding, kind, value, "")
		} else {
			err = vault.PrepareClearKind(ctx, binding, kind)
		}
		if err == nil {
			prepared = append(prepared, kind)
		}
		return err
	}

	proxyConfigured := strings.TrimSpace(provider.ProxyUsername) != "" || provider.ProxyPassword != ""
	proxyPayload := ""
	if proxyConfigured {
		encoded, err := json.Marshal(providerProxyAuthPayload{Username: provider.ProxyUsername, Password: provider.ProxyPassword})
		if err != nil {
			return provider, prepared, err
		}
		proxyPayload = string(encoded)
	}
	if err := prepare(secrets.ProviderProxyAuthKind, proxyPayload, proxyConfigured); err != nil {
		return provider, prepared, err
	}

	headerValues := make(map[string]string, len(provider.RequestHeaders))
	for _, header := range provider.RequestHeaders {
		name := strings.TrimSpace(header.Name)
		if name == "" || header.Value == "" {
			continue
		}
		headerValues[name] = header.Value
	}
	headerPayload := ""
	if len(headerValues) > 0 {
		encoded, err := json.Marshal(headerValues)
		if err != nil {
			return provider, prepared, err
		}
		headerPayload = string(encoded)
	}
	if err := prepare(secrets.ProviderRequestHeadersKind, headerPayload, len(headerValues) > 0); err != nil {
		return provider, prepared, err
	}
	if proxyConfigured {
		provider.ProxyAuthSource = secrets.ProviderSecretSourceStored
	} else {
		provider.ProxyAuthSource = secrets.ProviderSecretSourceNone
	}
	if len(headerValues) > 0 {
		provider.RequestHeadersSource = secrets.ProviderSecretSourceStored
	} else {
		provider.RequestHeadersSource = secrets.ProviderSecretSourceNone
	}
	return provider, prepared, nil
}

func rollbackPreparedProviderSecretKinds(ctx context.Context, vault *secrets.ProviderVault, prepared map[string][]string) []error {
	var warnings []error
	for name, kinds := range prepared {
		for _, kind := range kinds {
			if err := vault.RollbackPendingKind(ctx, name, kind); err != nil {
				warnings = append(warnings, err)
			}
		}
	}
	return warnings
}

func rollbackPreparedProviderMigrations(ctx context.Context, cfg *config.Config, vault *secrets.ProviderVault, preparedAPIKeys []string, preparedTransport map[string][]string) []error {
	var warnings []error
	apiKeyNames := make(map[string]struct{}, len(preparedAPIKeys))
	for _, name := range preparedAPIKeys {
		apiKeyNames[name] = struct{}{}
		if err := vault.RollbackPending(ctx, name); err != nil {
			warnings = append(warnings, err)
		}
	}
	warnings = append(warnings, rollbackPreparedProviderSecretKinds(ctx, vault, preparedTransport)...)
	if cfg == nil {
		return warnings
	}
	for i := range cfg.Providers.Instances {
		provider := &cfg.Providers.Instances[i]
		if _, ok := apiKeyNames[provider.Name]; ok {
			if provider.SecretRevision > 0 {
				provider.SecretRevision--
			}
			provider.APIKeySource = secrets.ProviderSecretSourceRuntime
		}
		if _, ok := preparedTransport[provider.Name]; !ok {
			continue
		}
		if provider.TransportSecretRevision > 0 {
			provider.TransportSecretRevision--
		}
		if strings.TrimSpace(provider.ProxyUsername) != "" || provider.ProxyPassword != "" {
			provider.ProxyAuthSource = secrets.ProviderSecretSourceRuntime
		} else {
			provider.ProxyAuthSource = secrets.ProviderSecretSourceNone
		}
		headersConfigured := len(provider.RequestHeaders) > 0
		for _, header := range provider.RequestHeaders {
			if strings.TrimSpace(header.Name) == "" || header.Value == "" {
				headersConfigured = false
				break
			}
		}
		if headersConfigured {
			provider.RequestHeadersSource = secrets.ProviderSecretSourceRuntime
		} else {
			provider.RequestHeadersSource = secrets.ProviderSecretSourceNone
		}
	}
	return warnings
}

// hydrateProviderSecrets resolves interrupted pending updates, migrates legacy
// config.json plaintext only when no encrypted record exists, and overlays
// stored secrets after environment-backed values have been identified.
func hydrateProviderSecrets(ctx context.Context, cfg config.Config, vault *secrets.ProviderVault, inputs map[string]config.ProviderAPIKeyInput, configPath string) (config.Config, []error) {
	if vault == nil {
		return cfg, nil
	}
	var warnings []error
	if err := vault.ReconcilePending(ctx, providerSecretBindings(cfg)); err != nil {
		warnings = append(warnings, err)
	}
	transportInputs, err := config.InspectProviderTransportSecretInputs(configPath)
	if err != nil {
		warnings = append(warnings, err)
		transportInputs = map[string]config.ProviderTransportSecretInput{}
	}

	prepared := make([]string, 0)
	preparedTransport := make(map[string][]string)
	needsConfigScrub := false
	migrationBlocked := false
	for i := range cfg.Providers.Instances {
		provider := cfg.Providers.Instances[i]
		input := inputs[provider.Name]
		switch input.Source {
		case config.ProviderAPIKeySourceEnvironment:
			provider.APIKey = input.APIKey
			provider.APIKeySource = secrets.ProviderSecretSourceEnvironment
			if input.LegacyConfigPresent {
				needsConfigScrub = true
			}
		case config.ProviderAPIKeySourceLegacyConfig:
			secret, _, err := vault.Resolve(ctx, providerSecretBinding(provider))
			switch {
			case err == nil:
				provider.APIKey = secret
				provider.APIKeySource = secrets.ProviderSecretSourceStored
				needsConfigScrub = true
			case errors.Is(err, secrets.ErrProviderSecretNotConfigured):
				provider.SecretRevision++
				provider.APIKey = input.APIKey
				if _, prepareErr := vault.PrepareSet(ctx, providerSecretBinding(provider), input.APIKey); prepareErr != nil {
					provider.SecretRevision--
					provider.APIKeySource = secrets.ProviderSecretSourceRuntime
					warnings = append(warnings, fmt.Errorf("migrate provider credential %s: %w", provider.Name, prepareErr))
				} else {
					provider.APIKeySource = secrets.ProviderSecretSourceStored
					prepared = append(prepared, provider.Name)
					needsConfigScrub = true
				}
			default:
				// An existing encrypted record with unavailable key material is
				// authoritative. Never create a replacement key or erase the
				// recoverable legacy config until the vault can be opened.
				provider.APIKey = ""
				provider.APIKeySource = secrets.ProviderSecretSourceStoredUnavailable
				warnings = append(warnings, fmt.Errorf("load stored provider credential %s: %w", provider.Name, err))
			}
		default:
			secret, _, err := vault.Resolve(ctx, providerSecretBinding(provider))
			switch {
			case err == nil:
				provider.APIKey = secret
				provider.APIKeySource = secrets.ProviderSecretSourceStored
			case errors.Is(err, secrets.ErrProviderSecretNotConfigured):
				provider.APIKey = ""
				provider.APIKeySource = secrets.ProviderSecretSourceNone
			default:
				provider.APIKey = ""
				provider.APIKeySource = secrets.ProviderSecretSourceStoredUnavailable
				warnings = append(warnings, fmt.Errorf("load stored provider credential %s: %w", provider.Name, err))
			}
		}
		provider, transportWarnings := hydrateProviderTransportSecrets(ctx, provider, vault)
		warnings = append(warnings, transportWarnings...)
		if transportInput := transportInputs[provider.Name]; transportInput.LegacyPresent() {
			migrated, kinds, migrationErr := prepareLegacyProviderTransportSecrets(ctx, provider, transportInput, vault)
			if migrationErr != nil {
				migrationBlocked = true
				for _, kind := range kinds {
					_ = vault.RollbackPendingKind(ctx, provider.Name, kind)
				}
				warnings = append(warnings, fmt.Errorf("migrate provider transport secrets %s: %w", provider.Name, migrationErr))
			} else {
				provider = migrated
				if len(kinds) > 0 {
					preparedTransport[provider.Name] = append(preparedTransport[provider.Name], kinds...)
				}
				needsConfigScrub = true
			}
		}
		cfg.Providers.Instances[i] = provider
	}

	if migrationBlocked {
		warnings = append(warnings, rollbackPreparedProviderMigrations(ctx, &cfg, vault, prepared, preparedTransport)...)
		return cfg, warnings
	}
	if !needsConfigScrub {
		return cfg, warnings
	}
	if err := config.Save(configPath, cfg); err != nil {
		warnings = append(warnings, rollbackPreparedProviderMigrations(ctx, &cfg, vault, prepared, preparedTransport)...)
		warnings = append(warnings, fmt.Errorf("scrub migrated provider credentials from config: %w", err))
		return cfg, warnings
	}
	for _, name := range prepared {
		if err := vault.CommitPending(ctx, name); err != nil {
			// The matching config revision is already durable. Leave pending in
			// place so the next startup reconciliation can safely commit it.
			warnings = append(warnings, err)
		}
	}
	for name, kinds := range preparedTransport {
		for _, kind := range kinds {
			if err := vault.CommitPendingKind(ctx, name, kind); err != nil {
				warnings = append(warnings, err)
			}
		}
	}
	return cfg, warnings
}
