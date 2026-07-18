package oauthapp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	DefaultOIDCRequestTimeout = 15 * time.Second
	loginRandomBytes          = 32
	loginGenerationAttempts   = 4
)

var (
	ErrInvalidConfiguration = errors.New("OIDC relying party configuration is invalid")
	ErrOIDCDiscovery        = errors.New("OIDC discovery failed")
	ErrSecureRandom         = errors.New("secure OIDC random generation failed")
	ErrInvalidCallback      = errors.New("OIDC callback is invalid")
	ErrAuthorizationFailed  = errors.New("OIDC authorization was not completed")
	ErrTokenExchange        = errors.New("OIDC token exchange failed")
	ErrIDTokenVerification  = errors.New("OIDC ID token verification failed")
)

// Config contains runtime-only OIDC relying party configuration. ClientSecret
// may be empty for a public client. This package never persists configuration
// or returned upstream tokens.
type Config struct {
	IssuerURL       string
	ClientID        string
	ClientSecret    string
	RedirectURL     string
	Scopes          []string
	TokenAuthStyle  oauth2.AuthStyle
	SessionTTL      time.Duration
	SessionCapacity int
	RequestTimeout  time.Duration
	HTTPClient      *http.Client
	Now             func() time.Time
	Random          io.Reader
}

// AuthorizationRequest is safe for a server handler to use as an HTTP redirect
// target. State, nonce, and the PKCE verifier remain in the private session
// store; state and nonce are present only inside URL as required by OIDC.
type AuthorizationRequest struct {
	URL            string
	BrowserBinding string
	ExpiresAt      time.Time
}

// IdentityKey is the sole stable identity key. Mutable claims such as email or
// username must never be used to link accounts.
type IdentityKey struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

// Identity contains the verified subject and selected standard OIDC claims.
type Identity struct {
	Issuer            string `json:"issuer"`
	Subject           string `json:"subject"`
	Email             string `json:"email,omitempty"`
	EmailVerified     bool   `json:"emailVerified"`
	Name              string `json:"name,omitempty"`
	PreferredUsername string `json:"preferredUsername,omitempty"`
}

func (identity Identity) Key() IdentityKey {
	return IdentityKey{Issuer: identity.Issuer, Subject: identity.Subject}
}

// CallbackResult contains only verified identity data and a validated local
// redirect. Raw OAuth and ID tokens are deliberately not returned.
type CallbackResult struct {
	Identity      Identity    `json:"identity"`
	IdentityKey   IdentityKey `json:"identityKey"`
	RedirectAfter string      `json:"redirectAfter"`
}

// RelyingParty performs OIDC discovery once and owns a bounded store of pending
// login sessions. Its methods are safe for concurrent server handlers.
type RelyingParty struct {
	issuer         string
	clientID       string
	oauth2Config   oauth2.Config
	verifier       *oidc.IDTokenVerifier
	sessions       *loginSessionStore
	httpClient     *http.Client
	requestTimeout time.Duration
	random         io.Reader
	randomMu       sync.Mutex
}

type discoveryMetadata struct {
	Issuer            string   `json:"issuer"`
	JWKSURL           string   `json:"jwks_uri"`
	SigningAlgorithms []string `json:"id_token_signing_alg_values_supported"`
}

type verifiedClaims struct {
	Nonce             string `json:"nonce"`
	AuthorizedParty   string `json:"azp"`
	Email             string `json:"email"`
	EmailVerified     bool   `json:"email_verified"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
}

func NewRelyingParty(ctx context.Context, config Config) (*RelyingParty, error) {
	issuer, clientID, redirectURL, scopes, authStyle, timeout, now, err := normalizeConfig(config)
	if err != nil {
		return nil, err
	}
	httpClient := secureHTTPClient(config.HTTPClient, timeout)
	store, err := newLoginSessionStore(loginSessionStoreOptions{
		TTL:      config.SessionTTL,
		Capacity: config.SessionCapacity,
		Now:      now,
	})
	if err != nil {
		return nil, ErrInvalidConfiguration
	}

	discoveryContext, cancel := requestContext(ctx, timeout, httpClient)
	provider, err := oidc.NewProvider(discoveryContext, issuer)
	if err != nil {
		contextError := discoveryContext.Err()
		cancel()
		if contextError != nil {
			return nil, contextError
		}
		return nil, ErrOIDCDiscovery
	}
	var metadata discoveryMetadata
	if err := provider.Claims(&metadata); err != nil {
		cancel()
		return nil, ErrOIDCDiscovery
	}
	cancel()

	if metadata.Issuer != issuer || validateEndpointURL(metadata.JWKSURL) != nil {
		return nil, ErrOIDCDiscovery
	}
	endpoint := provider.Endpoint()
	if validateEndpointURL(endpoint.AuthURL) != nil || validateEndpointURL(endpoint.TokenURL) != nil {
		return nil, ErrOIDCDiscovery
	}
	endpoint.AuthStyle = authStyle

	keySetContext := oidc.ClientContext(context.Background(), httpClient)
	keySet := oidc.NewRemoteKeySet(keySetContext, metadata.JWKSURL)
	verifierConfig := &oidc.Config{
		ClientID:             clientID,
		SupportedSigningAlgs: metadata.SigningAlgorithms,
		Now:                  now,
	}
	verifier := oidc.NewVerifier(metadata.Issuer, keySet, verifierConfig)

	randomSource := config.Random
	if randomSource == nil {
		randomSource = rand.Reader
	}
	return &RelyingParty{
		issuer:   metadata.Issuer,
		clientID: clientID,
		oauth2Config: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: config.ClientSecret,
			Endpoint:     endpoint,
			RedirectURL:  redirectURL,
			Scopes:       scopes,
		},
		verifier:       verifier,
		sessions:       store,
		httpClient:     httpClient,
		requestTimeout: timeout,
		random:         randomSource,
	}, nil
}

// BeginLogin creates a one-time authorization attempt using independent random
// state, nonce, and PKCE verifier values and returns the provider redirect URL.
func (party *RelyingParty) BeginLogin(redirectAfter string) (AuthorizationRequest, error) {
	normalizedRedirect, err := NormalizeRedirectAfter(redirectAfter)
	if err != nil {
		return AuthorizationRequest{}, err
	}

	for attempt := 0; attempt < loginGenerationAttempts; attempt++ {
		state, nonce, verifier, browserBinding, err := party.loginSecrets()
		if err != nil {
			return AuthorizationRequest{}, err
		}
		authorizationURL := party.oauth2Config.AuthCodeURL(
			state,
			oauth2.S256ChallengeOption(verifier),
			oidc.Nonce(nonce),
		)
		session, err := party.sessions.create(state, nonce, verifier, browserBinding, normalizedRedirect)
		if errors.Is(err, errDuplicateLoginState) {
			continue
		}
		if err != nil {
			return AuthorizationRequest{}, err
		}
		return AuthorizationRequest{URL: authorizationURL, BrowserBinding: browserBinding, ExpiresAt: session.expiresAt}, nil
	}
	return AuthorizationRequest{}, ErrSecureRandom
}

// HandleCallback strictly accepts a single state value, atomically consumes the
// matching session before inspecting an authorization error or code, exchanges
// the code with its PKCE verifier, and verifies the returned ID token.
func (party *RelyingParty) HandleCallback(ctx context.Context, query url.Values, browserBinding string) (CallbackResult, error) {
	state, err := singleCallbackValue(query, "state")
	if err != nil {
		return CallbackResult{}, ErrInvalidCallback
	}
	session, err := party.sessions.consume(state, browserBinding)
	if err != nil {
		return CallbackResult{}, err
	}

	if values, present := query["error"]; present {
		if len(values) != 1 || values[0] == "" {
			return CallbackResult{}, ErrInvalidCallback
		}
		return CallbackResult{}, ErrAuthorizationFailed
	}
	code, err := singleCallbackValue(query, "code")
	if err != nil {
		return CallbackResult{}, ErrInvalidCallback
	}

	requestCtx, cancel := requestContext(ctx, party.requestTimeout, party.httpClient)
	defer cancel()
	token, err := party.oauth2Config.Exchange(requestCtx, code, oauth2.VerifierOption(session.verifier))
	if err != nil {
		if requestCtx.Err() != nil {
			return CallbackResult{}, requestCtx.Err()
		}
		return CallbackResult{}, ErrTokenExchange
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || strings.TrimSpace(rawIDToken) == "" {
		return CallbackResult{}, ErrIDTokenVerification
	}
	idToken, err := party.verifier.Verify(requestCtx, rawIDToken)
	if err != nil {
		if requestCtx.Err() != nil {
			return CallbackResult{}, requestCtx.Err()
		}
		return CallbackResult{}, ErrIDTokenVerification
	}
	var claims verifiedClaims
	if err := idToken.Claims(&claims); err != nil {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if idToken.Issuer != party.issuer || idToken.Subject == "" || strings.ContainsRune(idToken.Subject, 0) {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if !audienceContains(idToken.Audience, party.clientID) {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if claims.AuthorizedParty != "" && claims.AuthorizedParty != party.clientID {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if len(idToken.Audience) > 1 && claims.AuthorizedParty != party.clientID {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if claims.Nonce == "" || claims.Nonce != session.nonce {
		return CallbackResult{}, ErrIDTokenVerification
	}
	if idToken.AccessTokenHash != "" {
		if token.AccessToken == "" || idToken.VerifyAccessToken(token.AccessToken) != nil {
			return CallbackResult{}, ErrIDTokenVerification
		}
	}

	identity := Identity{
		Issuer:            idToken.Issuer,
		Subject:           idToken.Subject,
		Email:             strings.TrimSpace(claims.Email),
		EmailVerified:     claims.EmailVerified,
		Name:              strings.TrimSpace(claims.Name),
		PreferredUsername: strings.TrimSpace(claims.PreferredUsername),
	}
	return CallbackResult{
		Identity:      identity,
		IdentityKey:   identity.Key(),
		RedirectAfter: session.redirectAfter,
	}, nil
}

func (party *RelyingParty) loginSecrets() (state, nonce, verifier, browserBinding string, err error) {
	party.randomMu.Lock()
	defer party.randomMu.Unlock()

	values := make([]string, 4)
	for index := range values {
		buffer := make([]byte, loginRandomBytes)
		if _, readErr := io.ReadFull(party.random, buffer); readErr != nil {
			return "", "", "", "", ErrSecureRandom
		}
		values[index] = base64.RawURLEncoding.EncodeToString(buffer)
	}
	return values[0], values[1], values[2], values[3], nil
}

func normalizeConfig(config Config) (issuer, clientID, redirectURL string, scopes []string, authStyle oauth2.AuthStyle, timeout time.Duration, now func() time.Time, err error) {
	issuer, err = validateIssuerURL(config.IssuerURL)
	if err != nil {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	clientID = strings.TrimSpace(config.ClientID)
	if clientID == "" || strings.ContainsRune(clientID, 0) || strings.ContainsRune(config.ClientSecret, 0) {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	redirectURL, err = validateRedirectURL(config.RedirectURL)
	if err != nil {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	scopes, err = normalizeScopes(config.Scopes)
	if err != nil {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	authStyle = config.TokenAuthStyle
	if authStyle == oauth2.AuthStyleAutoDetect {
		if config.ClientSecret == "" {
			authStyle = oauth2.AuthStyleInParams
		} else {
			authStyle = oauth2.AuthStyleInHeader
		}
	}
	if authStyle != oauth2.AuthStyleInHeader && authStyle != oauth2.AuthStyleInParams {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	timeout = config.RequestTimeout
	if timeout == 0 {
		timeout = DefaultOIDCRequestTimeout
	}
	if timeout < 0 {
		return "", "", "", nil, 0, 0, nil, ErrInvalidConfiguration
	}
	now = config.Now
	if now == nil {
		now = time.Now
	}
	return issuer, clientID, redirectURL, scopes, authStyle, timeout, now, nil
}

func validateIssuerURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || raw == "" || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != "" {
		return "", ErrInvalidConfiguration
	}
	if !secureHTTPSOrLoopbackHTTP(parsed) {
		return "", ErrInvalidConfiguration
	}
	return raw, nil
}

func validateRedirectURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || raw == "" || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" || parsed.Fragment != "" || parsed.RawFragment != "" {
		return "", ErrInvalidConfiguration
	}
	if !secureHTTPSOrLoopbackHTTP(parsed) {
		return "", ErrInvalidConfiguration
	}
	return parsed.String(), nil
}

func validateEndpointURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" || parsed.Fragment != "" || parsed.RawFragment != "" {
		return ErrOIDCDiscovery
	}
	if !secureHTTPSOrLoopbackHTTP(parsed) {
		return ErrOIDCDiscovery
	}
	return nil
}

func secureHTTPSOrLoopbackHTTP(parsed *url.URL) bool {
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func normalizeScopes(configured []string) ([]string, error) {
	if len(configured) == 0 {
		return []string{oidc.ScopeOpenID, "profile", "email"}, nil
	}
	seen := make(map[string]struct{}, len(configured)+1)
	scopes := make([]string, 0, len(configured)+1)
	for _, scope := range configured {
		scope = strings.TrimSpace(scope)
		if scope == "" || strings.IndexFunc(scope, unicode.IsSpace) >= 0 || strings.ContainsRune(scope, 0) {
			return nil, ErrInvalidConfiguration
		}
		if _, exists := seen[scope]; exists {
			continue
		}
		seen[scope] = struct{}{}
		scopes = append(scopes, scope)
	}
	if _, exists := seen[oidc.ScopeOpenID]; !exists {
		scopes = append([]string{oidc.ScopeOpenID}, scopes...)
	}
	return scopes, nil
}

func secureHTTPClient(configured *http.Client, timeout time.Duration) *http.Client {
	source := configured
	if source == nil {
		source = http.DefaultClient
	}
	client := *source
	if client.Timeout <= 0 || client.Timeout > timeout {
		client.Timeout = timeout
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &client
}

func requestContext(parent context.Context, timeout time.Duration, client *http.Client) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	timed, cancel := context.WithTimeout(parent, timeout)
	return oidc.ClientContext(timed, client), cancel
}

func singleCallbackValue(query url.Values, key string) (string, error) {
	values, exists := query[key]
	if !exists || len(values) != 1 || values[0] == "" {
		return "", ErrInvalidCallback
	}
	return values[0], nil
}

func audienceContains(audience []string, clientID string) bool {
	for _, value := range audience {
		if value == clientID {
			return true
		}
	}
	return false
}
