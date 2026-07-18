package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	OAuthAppScopeProjectsRead      = "projects:read"
	OAuthAppScopeAgentsRead        = "agents:read"
	OAuthAppScopeMessagesRead      = "messages:read"
	OAuthAppScopeAgentsRunReadOnly = "agents:run:readOnly"
)

// OAuthAppConfig configures the built-in OIDC relying-party application. The
// client secret itself is never persisted: ClientSecretEnv names the process
// environment variable that supplies it at runtime.
type OAuthAppConfig struct {
	Enabled             bool     `json:"enabled"`
	IssuerURL           string   `json:"issuerUrl,omitempty"`
	ClientID            string   `json:"clientId,omitempty"`
	ClientSecretEnv     string   `json:"clientSecretEnv,omitempty"`
	RedirectURL         string   `json:"redirectUrl,omitempty"`
	AllowedEmailDomains []string `json:"allowedEmailDomains,omitempty"`
	AutoProvision       bool     `json:"autoProvision"`
	SessionTTLHours     int      `json:"sessionTtlHours,omitempty"`
	AllowReadOnlyTasks  bool     `json:"allowReadOnlyTasks"`
}

func (cfg OAuthAppConfig) Normalized() OAuthAppConfig {
	cfg.IssuerURL = strings.TrimSpace(cfg.IssuerURL)
	cfg.ClientID = strings.TrimSpace(cfg.ClientID)
	cfg.ClientSecretEnv = strings.TrimSpace(cfg.ClientSecretEnv)
	cfg.RedirectURL = strings.TrimSpace(cfg.RedirectURL)
	if cfg.SessionTTLHours <= 0 {
		cfg.SessionTTLHours = 8
	}
	seen := make(map[string]struct{}, len(cfg.AllowedEmailDomains))
	domains := make([]string, 0, len(cfg.AllowedEmailDomains))
	for _, domain := range cfg.AllowedEmailDomains {
		domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		domains = append(domains, domain)
	}
	sort.Strings(domains)
	cfg.AllowedEmailDomains = domains
	return cfg
}

func (cfg OAuthAppConfig) Validate() error {
	cfg = cfg.Normalized()
	if cfg.SessionTTLHours < 1 || cfg.SessionTTLHours > 24*7 {
		return errors.New("OAuth app session TTL must be between 1 and 168 hours")
	}
	for _, domain := range cfg.AllowedEmailDomains {
		if !validOAuthAppEmailDomain(domain) {
			return errors.New("OAuth app allowed email domain is invalid")
		}
	}
	if !cfg.Enabled {
		return nil
	}
	if cfg.ClientID == "" || len(cfg.ClientID) > 1024 || !utf8.ValidString(cfg.ClientID) || containsUnsafeConfigText(cfg.ClientID) {
		return errors.New("OAuth app client ID is invalid")
	}
	if cfg.ClientSecretEnv != "" && !validEnvironmentVariableName(cfg.ClientSecretEnv) {
		return errors.New("OAuth app client secret environment variable name is invalid")
	}
	issuer, err := validateOAuthAppURL("issuer", cfg.IssuerURL, false)
	if err != nil {
		return err
	}
	if issuer.RawQuery != "" {
		return errors.New("OAuth app issuer URL must not contain a query")
	}
	redirect, err := validateOAuthAppURL("redirect", cfg.RedirectURL, true)
	if err != nil {
		return err
	}
	if redirect.Path != "/app/auth/callback" || redirect.RawQuery != "" {
		return errors.New("OAuth app redirect URL must use the exact /app/auth/callback path without a query")
	}
	return nil
}

func (cfg OAuthAppConfig) ClientSecret() (string, error) {
	cfg = cfg.Normalized()
	if cfg.ClientSecretEnv == "" {
		return "", nil
	}
	if !validEnvironmentVariableName(cfg.ClientSecretEnv) {
		return "", errors.New("OAuth app client secret environment variable name is invalid")
	}
	secret, ok := os.LookupEnv(cfg.ClientSecretEnv)
	if !ok || strings.TrimSpace(secret) == "" {
		return "", fmt.Errorf("OAuth app client secret environment variable %s is not set", cfg.ClientSecretEnv)
	}
	return secret, nil
}

func (cfg OAuthAppConfig) Scopes() []string {
	scopes := []string{OAuthAppScopeProjectsRead, OAuthAppScopeAgentsRead, OAuthAppScopeMessagesRead}
	if cfg.AllowReadOnlyTasks {
		scopes = append(scopes, OAuthAppScopeAgentsRunReadOnly)
	}
	return scopes
}

func (cfg OAuthAppConfig) AllowsEmail(email string, verified bool) bool {
	cfg = cfg.Normalized()
	if !verified {
		return false
	}
	at := strings.LastIndex(strings.TrimSpace(email), "@")
	if at <= 0 || at == len(email)-1 {
		return false
	}
	domain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(email[at+1:])), ".")
	if !validOAuthAppEmailDomain(domain) {
		return false
	}
	if len(cfg.AllowedEmailDomains) == 0 {
		return true
	}
	for _, allowed := range cfg.AllowedEmailDomains {
		if domain == allowed {
			return true
		}
	}
	return false
}

func validateOAuthAppURL(label, raw string, requireCallback bool) (*url.URL, error) {
	if strings.TrimSpace(raw) == "" || len(raw) > 4096 || !utf8.ValidString(raw) || strings.ContainsRune(raw, 0) {
		return nil, fmt.Errorf("OAuth app %s URL is invalid", label)
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return nil, fmt.Errorf("OAuth app %s URL is invalid", label)
	}
	host := parsed.Hostname()
	loopback := strings.EqualFold(host, "localhost")
	if ip := net.ParseIP(host); ip != nil {
		loopback = ip.IsLoopback()
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return nil, fmt.Errorf("OAuth app %s URL must use HTTPS except for loopback development", label)
	}
	if requireCallback && parsed.Path == "" {
		return nil, errors.New("OAuth app redirect URL path is required")
	}
	return parsed, nil
}

func validEnvironmentVariableName(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for index, char := range value {
		if index == 0 {
			if char != '_' && !unicode.IsLetter(char) {
				return false
			}
			continue
		}
		if char != '_' && !unicode.IsLetter(char) && !unicode.IsDigit(char) {
			return false
		}
	}
	return true
}

func validOAuthAppEmailDomain(domain string) bool {
	if domain == "" || len(domain) > 253 || !utf8.ValidString(domain) || strings.Contains(domain, "..") {
		return false
	}
	labels := strings.Split(domain, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func containsUnsafeConfigText(value string) bool {
	for _, char := range value {
		if unicode.IsControl(char) || unicode.Is(unicode.Cf, char) {
			return true
		}
	}
	return false
}
