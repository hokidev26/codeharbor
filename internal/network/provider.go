package network

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ProviderHTTPConfig contains runtime-only transport settings. Callers must not
// persist ProxyUsername, ProxyPassword, or Headers in plaintext.
type ProviderHTTPConfig struct {
	ProxyURL              string
	ProxyUsername         string
	ProxyPassword         string
	UserAgent             string
	Headers               http.Header
	InsecureSkipTLSVerify bool
}

// ValidateProviderBaseURL validates a user-configurable provider base URL. A
// provider may target a public HTTPS endpoint or a loopback HTTP(S) endpoint.
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

// ValidateProviderProxyURL validates and resolves a fixed Provider proxy without
// returning its address or credentials through errors.
func ValidateProviderProxyURL(ctx context.Context, raw string, opts ...Option) error {
	target, err := parseProviderProxyURL(raw)
	if err != nil {
		return err
	}
	_, err = resolveAllowed(ctx, PolicyProviderProxy, target.Hostname(), applyOptions(opts...))
	return err
}

// NewProviderHTTPClient returns a proxy-free client for provider traffic. It
// validates every redirect target before refusing the redirect, so a provider
// can never use redirects to reach a different network class.
func NewProviderHTTPClient(timeout time.Duration, opts ...Option) *http.Client {
	client, _ := NewConfiguredProviderHTTPClient(timeout, ProviderHTTPConfig{}, opts...)
	return client
}

// NewConfiguredProviderHTTPClient builds a Provider-scoped transport. A proxy is
// used only when explicitly configured; environment proxy variables stay ignored.
func NewConfiguredProviderHTTPClient(timeout time.Duration, provider ProviderHTTPConfig, opts ...Option) (*http.Client, error) {
	cfg := applyOptions(opts...)
	if timeout <= 0 {
		timeout = 90 * time.Second
	}

	var transport *http.Transport
	proxyRaw := strings.TrimSpace(provider.ProxyURL)
	if proxyRaw == "" {
		transport = NewProviderDirectTransport(opts...)
	} else {
		proxyURL, err := parseProviderProxyURL(proxyRaw)
		if err != nil {
			return nil, err
		}
		if _, err := resolveAllowed(context.Background(), PolicyProviderProxy, proxyURL.Hostname(), cfg); err != nil {
			return nil, err
		}
		if provider.ProxyUsername != "" || provider.ProxyPassword != "" {
			if provider.ProxyPassword != "" {
				proxyURL.User = url.UserPassword(provider.ProxyUsername, provider.ProxyPassword)
			} else {
				proxyURL.User = url.User(provider.ProxyUsername)
			}
		}
		transport = http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = redactingProxy(http.ProxyURL(proxyURL))
		transport.DialContext = directDialContext(PolicyProviderProxy, cfg)
	}
	if provider.InsecureSkipTLSVerify {
		tlsConfig := transport.TLSClientConfig
		if tlsConfig == nil {
			tlsConfig = &tls.Config{}
		} else {
			tlsConfig = tlsConfig.Clone()
		}
		// This setting is explicit, scoped to one Provider, and surfaced as a
		// dangerous option in the UI.
		tlsConfig.InsecureSkipVerify = true //nolint:gosec
		transport.TLSClientConfig = tlsConfig
	}

	var roundTripper http.RoundTripper = transport
	if strings.TrimSpace(provider.UserAgent) != "" || len(provider.Headers) > 0 {
		roundTripper = &providerHeaderRoundTripper{
			base:      roundTripper,
			userAgent: strings.TrimSpace(provider.UserAgent),
			headers:   provider.Headers.Clone(),
		}
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: roundTripper,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req == nil {
				return ErrInvalidURL
			}
			if err := validateURL(req.Context(), PolicyProviderDirect, req.URL, cfg); err != nil {
				return err
			}
			return ErrRedirectDenied
		},
	}, nil
}

func parseProviderProxyURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\x00\r\n") {
		return nil, ErrProxyConfiguration
	}
	target, err := url.Parse(raw)
	if err != nil || !target.IsAbs() || target.Opaque != "" || target.Host == "" || target.Hostname() == "" {
		return nil, ErrProxyConfiguration
	}
	if target.Fragment != "" || target.RawFragment != "" || target.RawQuery != "" || target.ForceQuery || (target.Path != "" && target.Path != "/") {
		return nil, ErrProxyConfiguration
	}
	switch strings.ToLower(target.Scheme) {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, ErrProxyConfiguration
	}
	if port := target.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return nil, ErrProxyConfiguration
		}
	}
	clone := *target
	clone.Scheme = strings.ToLower(clone.Scheme)
	clone.Host = strings.ToLower(clone.Host)
	clone.Path = ""
	return &clone, nil
}

type providerHeaderRoundTripper struct {
	base      http.RoundTripper
	userAgent string
	headers   http.Header
}

func (t *providerHeaderRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, ErrInvalidURL
	}
	clone := req.Clone(req.Context())
	clone.Header = req.Header.Clone()
	if t.userAgent != "" {
		clone.Header.Set("User-Agent", t.userAgent)
	}
	for name, values := range t.headers {
		// Provider-scoped custom headers are explicit user overrides. Reserved
		// transport headers are rejected before this layer, while values such as
		// Authorization must be able to replace SDK defaults.
		clone.Header.Del(name)
		for _, value := range values {
			clone.Header.Add(name, value)
		}
	}
	return t.base.RoundTrip(clone)
}
