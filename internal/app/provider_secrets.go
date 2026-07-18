package app

import (
	"context"
	"errors"
	"fmt"

	"autoto/internal/config"
	"autoto/internal/secrets"
)

func providerSecretBinding(provider config.ProviderConfig) secrets.ProviderBinding {
	return secrets.ProviderBinding{
		Name:           provider.Name,
		Type:           provider.Type,
		Profile:        provider.Profile,
		BaseURL:        provider.BaseURL,
		SecretRevision: provider.SecretRevision,
	}
}

func providerSecretBindings(cfg config.Config) map[string]secrets.ProviderBinding {
	bindings := make(map[string]secrets.ProviderBinding, len(cfg.Providers.Instances))
	for _, provider := range cfg.Providers.Instances {
		bindings[provider.Name] = providerSecretBinding(provider)
	}
	return bindings
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

	prepared := make([]string, 0)
	needsConfigScrub := false
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
		cfg.Providers.Instances[i] = provider
	}

	if !needsConfigScrub {
		return cfg, warnings
	}
	if err := config.Save(configPath, cfg); err != nil {
		for _, name := range prepared {
			if rollbackErr := vault.RollbackPending(ctx, name); rollbackErr != nil {
				warnings = append(warnings, rollbackErr)
			}
			for i := range cfg.Providers.Instances {
				if cfg.Providers.Instances[i].Name == name {
					cfg.Providers.Instances[i].APIKeySource = secrets.ProviderSecretSourceRuntime
				}
			}
		}
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
	return cfg, warnings
}
