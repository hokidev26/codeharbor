package providers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"autoto/internal/config"
	"autoto/internal/network"
)

func validateProviderRuntimeConfig(cfg config.ProviderConfig) error {
	if err := validateProviderRuntimeIdentity(cfg); err != nil {
		return err
	}
	if cfg.Type == config.ProviderTypeCodex || strings.TrimSpace(cfg.BaseURL) == "" {
		return nil
	}
	return network.ValidateProviderBaseURL(context.Background(), cfg.BaseURL)
}

func providerHTTPClient(timeout time.Duration) *http.Client {
	return network.NewProviderHTTPClient(timeout)
}
