package network

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ValidateProviderBaseURL validates a user-configurable provider base URL. A
// provider may target a public HTTPS endpoint or a loopback HTTP(S) endpoint;
// proxies and redirects are never used by the corresponding client.
func ValidateProviderBaseURL(ctx context.Context, raw string, opts ...Option) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ErrInvalidURL
	}
	target, err := url.Parse(raw)
	if err != nil {
		return ErrInvalidURL
	}
	if target.User != nil || target.Fragment != "" || target.RawFragment != "" || target.RawQuery != "" || target.ForceQuery || strings.Contains(raw, "#") {
		return ErrInvalidURL
	}
	return validateURL(ctx, PolicyProviderDirect, target, applyOptions(opts...))
}

// NewProviderHTTPClient returns a proxy-free client for provider traffic. It
// validates every redirect target before refusing the redirect, so a provider
// can never use redirects to reach a different network class.
func NewProviderHTTPClient(timeout time.Duration, opts ...Option) *http.Client {
	cfg := applyOptions(opts...)
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: NewProviderDirectTransport(opts...),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req == nil {
				return ErrInvalidURL
			}
			if err := validateURL(req.Context(), PolicyProviderDirect, req.URL, cfg); err != nil {
				return err
			}
			return ErrRedirectDenied
		},
	}
}
