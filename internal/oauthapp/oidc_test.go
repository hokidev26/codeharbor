package oauthapp

import (
	"context"
	"crypto"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testOIDCClientID    = "enterprise-client"
	testOIDCRedirectURL = "http://127.0.0.1:18080/auth/oidc/callback"
)

var (
	fakeOIDCKeyOnce sync.Once
	fakeOIDCKey     *rsa.PrivateKey
	fakeOIDCKeyErr  error
)

type fakeTokenResponder func(http.ResponseWriter, *http.Request, url.Values)

type failingRandomReader struct{}

func (failingRandomReader) Read([]byte) (int, error) {
	return 0, errors.New("injected random source detail")
}

type fakeOIDCProvider struct {
	t              *testing.T
	server         *httptest.Server
	key            *rsa.PrivateKey
	clock          *testClock
	discoveryCount atomic.Int32
	jwksCount      atomic.Int32
	tokenCount     atomic.Int32

	mu                sync.Mutex
	discoveryIssuer   string
	claims            map[string]any
	responder         fakeTokenResponder
	lastForm          url.Values
	lastAuthorization string
	lastBasicID       string
	lastBasicSecret   string
	lastIDToken       string
}

func newFakeOIDCProvider(t *testing.T, clock *testClock) *fakeOIDCProvider {
	t.Helper()
	fakeOIDCKeyOnce.Do(func() {
		fakeOIDCKey, fakeOIDCKeyErr = rsa.GenerateKey(cryptorand.Reader, 2048)
	})
	if fakeOIDCKeyErr != nil {
		t.Fatal(fakeOIDCKeyErr)
	}
	provider := &fakeOIDCProvider{t: t, key: fakeOIDCKey, clock: clock}
	provider.server = httptest.NewServer(http.HandlerFunc(provider.handle))
	t.Cleanup(provider.server.Close)
	return provider
}

func (provider *fakeOIDCProvider) handle(writer http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/.well-known/openid-configuration":
		provider.discoveryCount.Add(1)
		provider.mu.Lock()
		issuer := provider.discoveryIssuer
		provider.mu.Unlock()
		if issuer == "" {
			issuer = provider.server.URL
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"issuer":                                issuer,
			"authorization_endpoint":                provider.server.URL + "/authorize",
			"token_endpoint":                        provider.server.URL + "/token",
			"jwks_uri":                              provider.server.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	case "/jwks":
		provider.jwksCount.Add(1)
		publicKey := provider.key.PublicKey
		exponent := big.NewInt(int64(publicKey.E)).Bytes()
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA",
				"kid": "enterprise-test-key",
				"use": "sig",
				"alg": "RS256",
				"n":   base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(exponent),
			}},
		})
	case "/token":
		provider.handleToken(writer, request)
	default:
		http.NotFound(writer, request)
	}
}

func (provider *fakeOIDCProvider) handleToken(writer http.ResponseWriter, request *http.Request) {
	provider.tokenCount.Add(1)
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := request.ParseForm(); err != nil {
		writer.WriteHeader(http.StatusBadRequest)
		return
	}
	form := cloneValues(request.PostForm)
	basicID, basicSecret, _ := request.BasicAuth()

	provider.mu.Lock()
	provider.lastForm = form
	provider.lastAuthorization = request.Header.Get("Authorization")
	provider.lastBasicID = basicID
	provider.lastBasicSecret = basicSecret
	responder := provider.responder
	claims := cloneClaims(provider.claims)
	provider.mu.Unlock()

	if responder != nil {
		responder(writer, request, form)
		return
	}
	provider.writeToken(writer, claims)
}

func (provider *fakeOIDCProvider) writeToken(writer http.ResponseWriter, claims map[string]any) {
	provider.t.Helper()
	rawIDToken, err := signFakeIDToken(provider.key, claims)
	if err != nil {
		provider.t.Errorf("sign fake ID token: %v", err)
		writer.WriteHeader(http.StatusInternalServerError)
		return
	}
	provider.mu.Lock()
	provider.lastIDToken = rawIDToken
	provider.mu.Unlock()
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"access_token": "access-token-fixture",
		"token_type":   "Bearer",
		"expires_in":   300,
		"id_token":     rawIDToken,
	})
}

func (provider *fakeOIDCProvider) setClaims(claims map[string]any) {
	provider.mu.Lock()
	provider.claims = cloneClaims(claims)
	provider.mu.Unlock()
}

func (provider *fakeOIDCProvider) setResponder(responder fakeTokenResponder) {
	provider.mu.Lock()
	provider.responder = responder
	provider.mu.Unlock()
}

func (provider *fakeOIDCProvider) recordedTokenRequest() (url.Values, string, string, string, string) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	return cloneValues(provider.lastForm), provider.lastAuthorization, provider.lastBasicID, provider.lastBasicSecret, provider.lastIDToken
}

func newTestRelyingParty(t *testing.T, provider *fakeOIDCProvider, mutate func(*Config)) *RelyingParty {
	t.Helper()
	config := Config{
		IssuerURL:      provider.server.URL,
		ClientID:       testOIDCClientID,
		RedirectURL:    testOIDCRedirectURL,
		RequestTimeout: time.Second,
		HTTPClient:     provider.server.Client(),
		Now:            provider.clock.Now,
	}
	if mutate != nil {
		mutate(&config)
	}
	party, err := NewRelyingParty(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	return party
}

func validFakeClaims(provider *fakeOIDCProvider, nonce string) map[string]any {
	now := provider.clock.Now()
	return map[string]any{
		"iss":                provider.server.URL,
		"sub":                "subject-123",
		"aud":                testOIDCClientID,
		"exp":                now.Add(5 * time.Minute).Unix(),
		"iat":                now.Add(-time.Minute).Unix(),
		"nonce":              nonce,
		"email":              "person@example.com",
		"email_verified":     true,
		"name":               "Example Person",
		"preferred_username": "person",
	}
}

func beginOIDCLogin(t *testing.T, party *RelyingParty, provider *fakeOIDCProvider, redirectAfter string) (AuthorizationRequest, url.Values) {
	t.Helper()
	authorization, err := party.BeginLogin(redirectAfter)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(authorization.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("_browser_binding", authorization.BrowserBinding)
	provider.setClaims(validFakeClaims(provider, query.Get("nonce")))
	return authorization, query
}

func callbackQuery(authorizationQuery url.Values, code string) url.Values {
	return url.Values{
		"state": {authorizationQuery.Get("state")},
		"code":  {code},
	}
}

func TestRelyingPartyDiscoverySuccessClaimsAndPKCE(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, nil)
	if provider.discoveryCount.Load() != 1 {
		t.Fatalf("expected one discovery request, got %d", provider.discoveryCount.Load())
	}

	authorization, authorizationQuery := beginOIDCLogin(t, party, provider, "/app/settings?tab=security")
	if !authorization.ExpiresAt.Equal(clock.Now().Add(DefaultLoginSessionTTL)) {
		t.Fatalf("unexpected authorization expiry: %v", authorization.ExpiresAt)
	}
	for key, want := range map[string]string{
		"response_type":         "code",
		"client_id":             testOIDCClientID,
		"redirect_uri":          testOIDCRedirectURL,
		"code_challenge_method": "S256",
	} {
		if got := authorizationQuery.Get(key); got != want {
			t.Fatalf("authorization parameter %s=%q want %q", key, got, want)
		}
	}
	for _, scope := range []string{"openid", "profile", "email"} {
		if !strings.Contains(" "+authorizationQuery.Get("scope")+" ", " "+scope+" ") {
			t.Fatalf("missing scope %q in %q", scope, authorizationQuery.Get("scope"))
		}
	}
	state := authorizationQuery.Get("state")
	nonce := authorizationQuery.Get("nonce")
	challenge := authorizationQuery.Get("code_challenge")
	browserBinding := authorization.BrowserBinding
	if len(state) < 43 || len(nonce) < 43 || len(challenge) != 43 || len(browserBinding) < 43 || state == nonce || state == browserBinding || nonce == browserBinding {
		t.Fatalf("unexpected OIDC entropy: state=%d nonce=%d challenge=%d browser=%d", len(state), len(nonce), len(challenge), len(browserBinding))
	}
	if strings.Contains(authorization.URL, browserBinding) {
		t.Fatal("browser binding leaked into the authorization URL")
	}

	result, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "authorization-code-fixture"), authorizationQuery.Get("_browser_binding"))
	if err != nil {
		t.Fatal(err)
	}
	wantIdentity := Identity{
		Issuer:            provider.server.URL,
		Subject:           "subject-123",
		Email:             "person@example.com",
		EmailVerified:     true,
		Name:              "Example Person",
		PreferredUsername: "person",
	}
	if result.Identity != wantIdentity {
		t.Fatalf("unexpected identity: %+v", result.Identity)
	}
	if result.IdentityKey != (IdentityKey{Issuer: provider.server.URL, Subject: "subject-123"}) || result.Identity.Key() != result.IdentityKey {
		t.Fatalf("unexpected identity key: %+v", result.IdentityKey)
	}
	if result.RedirectAfter != "/app/settings?tab=security" {
		t.Fatalf("unexpected redirect-after: %q", result.RedirectAfter)
	}

	form, authorizationHeader, _, _, _ := provider.recordedTokenRequest()
	if form.Get("grant_type") != "authorization_code" || form.Get("client_id") != testOIDCClientID || form.Get("code") != "authorization-code-fixture" || form.Get("redirect_uri") != testOIDCRedirectURL {
		t.Fatalf("unexpected token form: %v", form)
	}
	verifier := form.Get("code_verifier")
	digest := sha256.Sum256([]byte(verifier))
	if verifier == "" || base64.RawURLEncoding.EncodeToString(digest[:]) != challenge {
		t.Fatalf("token request did not prove the S256 challenge")
	}
	if authorizationHeader != "" || form.Get("client_secret") != "" {
		t.Fatalf("public client unexpectedly sent a client secret")
	}
	if provider.tokenCount.Load() != 1 || provider.jwksCount.Load() != 1 {
		t.Fatalf("unexpected upstream counts: token=%d jwks=%d", provider.tokenCount.Load(), provider.jwksCount.Load())
	}
}

func TestCallbackStateReplayExpiryAndStrictValidation(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, func(config *Config) {
		config.SessionTTL = time.Minute
	})

	_, firstQuery := beginOIDCLogin(t, party, provider, "/app")
	firstCallback := callbackQuery(firstQuery, "first-code")
	if _, err := party.HandleCallback(context.Background(), firstCallback, firstQuery.Get("_browser_binding")); err != nil {
		t.Fatal(err)
	}
	if _, err := party.HandleCallback(context.Background(), firstCallback, firstQuery.Get("_browser_binding")); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("expected replay rejection, got %v", err)
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("replay reached token endpoint: %d", provider.tokenCount.Load())
	}

	_, strictQuery := beginOIDCLogin(t, party, provider, "/app")
	duplicateState := callbackQuery(strictQuery, "strict-code")
	duplicateState["state"] = []string{strictQuery.Get("state"), strictQuery.Get("state")}
	if _, err := party.HandleCallback(context.Background(), duplicateState, strictQuery.Get("_browser_binding")); !errors.Is(err, ErrInvalidCallback) {
		t.Fatalf("expected duplicate state rejection, got %v", err)
	}
	if _, err := party.HandleCallback(context.Background(), callbackQuery(strictQuery, "strict-code"), strictQuery.Get("_browser_binding")); err != nil {
		t.Fatalf("malformed state consumed a valid session: %v", err)
	}
	if provider.tokenCount.Load() != 2 {
		t.Fatalf("unexpected token count after strict callback: %d", provider.tokenCount.Load())
	}

	_, expiredQuery := beginOIDCLogin(t, party, provider, "/app")
	clock.Advance(time.Minute)
	if _, err := party.HandleCallback(context.Background(), callbackQuery(expiredQuery, "expired-code"), expiredQuery.Get("_browser_binding")); !errors.Is(err, ErrLoginSessionExpired) {
		t.Fatalf("expected expired state rejection, got %v", err)
	}
	if provider.tokenCount.Load() != 2 {
		t.Fatalf("expired callback reached token endpoint: %d", provider.tokenCount.Load())
	}

	_, consumedQuery := beginOIDCLogin(t, party, provider, "/app")
	if _, err := party.HandleCallback(context.Background(), url.Values{"state": {consumedQuery.Get("state")}}, consumedQuery.Get("_browser_binding")); !errors.Is(err, ErrInvalidCallback) {
		t.Fatalf("expected missing code rejection, got %v", err)
	}
	if _, err := party.HandleCallback(context.Background(), callbackQuery(consumedQuery, "late-code"), consumedQuery.Get("_browser_binding")); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("callback was not consumed before code validation: %v", err)
	}
	if provider.tokenCount.Load() != 2 {
		t.Fatalf("invalid code callback reached token endpoint: %d", provider.tokenCount.Load())
	}
}

func TestCallbackRejectsCrossBrowserBindingWithoutConsumingLogin(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, nil)

	_, victimQuery := beginOIDCLogin(t, party, provider, "/app")
	_, otherBrowserQuery := beginOIDCLogin(t, party, provider, "/app")
	provider.setClaims(validFakeClaims(provider, victimQuery.Get("nonce")))
	callback := callbackQuery(victimQuery, "victim-code")
	if _, err := party.HandleCallback(context.Background(), callback, otherBrowserQuery.Get("_browser_binding")); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("expected cross-browser callback rejection, got %v", err)
	}
	if provider.tokenCount.Load() != 0 {
		t.Fatalf("cross-browser callback reached token endpoint: %d", provider.tokenCount.Load())
	}
	if _, err := party.HandleCallback(context.Background(), callback, victimQuery.Get("_browser_binding")); err != nil {
		t.Fatalf("cross-browser rejection consumed the original login: %v", err)
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("original browser exchanged an unexpected number of times: %d", provider.tokenCount.Load())
	}
}

func TestIDTokenRejectsNonceIssuerAndAudience(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "nonce", mutate: func(claims map[string]any) { claims["nonce"] = "wrong-nonce" }},
		{name: "issuer", mutate: func(claims map[string]any) { claims["iss"] = "https://issuer.invalid" }},
		{name: "audience", mutate: func(claims map[string]any) { claims["aud"] = "another-client" }},
		{name: "multiple_audiences_without_azp", mutate: func(claims map[string]any) { claims["aud"] = []string{testOIDCClientID, "another-client"} }},
	} {
		t.Run(test.name, func(t *testing.T) {
			clock := newTestClock(time.Unix(1_700_000_000, 0))
			provider := newFakeOIDCProvider(t, clock)
			party := newTestRelyingParty(t, provider, nil)
			_, authorizationQuery := beginOIDCLogin(t, party, provider, "/app")
			claims := validFakeClaims(provider, authorizationQuery.Get("nonce"))
			test.mutate(claims)
			provider.setClaims(claims)

			_, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "invalid-token-code"), authorizationQuery.Get("_browser_binding"))
			if !errors.Is(err, ErrIDTokenVerification) {
				t.Fatalf("expected ID token rejection, got %v", err)
			}
			_, _, _, _, rawIDToken := provider.recordedTokenRequest()
			if rawIDToken != "" && strings.Contains(err.Error(), rawIDToken) {
				t.Fatal("ID token verification error leaked the raw token")
			}
		})
	}
}

func TestBeginLoginUsesInjectedRandomSourceWithoutLeakingErrors(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, func(config *Config) {
		config.Random = failingRandomReader{}
	})
	_, err := party.BeginLogin("/app")
	if !errors.Is(err, ErrSecureRandom) {
		t.Fatalf("expected secure random failure, got %v", err)
	}
	if strings.Contains(err.Error(), "injected random source detail") {
		t.Fatal("random source error detail was exposed")
	}
}

func TestRelyingPartySessionCapacity(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, func(config *Config) {
		config.SessionTTL = time.Minute
		config.SessionCapacity = 1
	})
	if _, err := party.BeginLogin("/app"); err != nil {
		t.Fatal(err)
	}
	if _, err := party.BeginLogin("/app"); !errors.Is(err, ErrLoginSessionCapacity) {
		t.Fatalf("expected capacity rejection, got %v", err)
	}
	clock.Advance(time.Minute)
	if _, err := party.BeginLogin("/app"); err != nil {
		t.Fatalf("expired session did not release capacity: %v", err)
	}
}

func TestConcurrentCallbacksExchangeOnce(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, nil)
	_, authorizationQuery := beginOIDCLogin(t, party, provider, "/app")
	claims := validFakeClaims(provider, authorizationQuery.Get("nonce"))

	entered := make(chan struct{})
	release := make(chan struct{})
	var enteredOnce sync.Once
	provider.setResponder(func(writer http.ResponseWriter, request *http.Request, form url.Values) {
		enteredOnce.Do(func() { close(entered) })
		<-release
		provider.writeToken(writer, claims)
	})

	firstResult := make(chan error, 1)
	go func() {
		_, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "shared-code"), authorizationQuery.Get("_browser_binding"))
		firstResult <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("first callback did not reach token endpoint")
	}
	if _, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "shared-code"), authorizationQuery.Get("_browser_binding")); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("second callback was not rejected while exchange was active: %v", err)
	}
	close(release)
	if err := <-firstResult; err != nil {
		t.Fatalf("winning callback failed: %v", err)
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("concurrent callbacks exchanged %d times", provider.tokenCount.Load())
	}
}

func TestTokenEndpointRedirectIsNotFollowed(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, nil)
	_, authorizationQuery := beginOIDCLogin(t, party, provider, "/app")

	var redirected atomic.Int32
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		redirected.Add(1)
		writer.WriteHeader(http.StatusOK)
	}))
	defer redirectTarget.Close()
	provider.setResponder(func(writer http.ResponseWriter, request *http.Request, form url.Values) {
		http.Redirect(writer, request, redirectTarget.URL+"/capture", http.StatusTemporaryRedirect)
	})

	if _, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "redirect-code"), authorizationQuery.Get("_browser_binding")); !errors.Is(err, ErrTokenExchange) {
		t.Fatalf("expected redirecting token endpoint failure, got %v", err)
	}
	if redirected.Load() != 0 {
		t.Fatal("token endpoint redirect was followed")
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("unexpected token request count: %d", provider.tokenCount.Load())
	}
}

func TestCallbackErrorsAreSanitizedAndClientSecretIsCallerSupplied(t *testing.T) {
	const (
		clientSecret = "client-secret-fixture"
		code         = "authorization-code-secret"
		accessToken  = "access-token-secret"
		idToken      = "id-token-secret"
	)
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, func(config *Config) {
		config.ClientSecret = clientSecret
	})
	_, authorizationQuery := beginOIDCLogin(t, party, provider, "/app")
	provider.setResponder(func(writer http.ResponseWriter, request *http.Request, form url.Values) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte("code=" + code + " verifier=" + form.Get("code_verifier") + " secret=" + clientSecret + " access=" + accessToken + " id=" + idToken))
	})

	_, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, code), authorizationQuery.Get("_browser_binding"))
	if !errors.Is(err, ErrTokenExchange) {
		t.Fatalf("expected token exchange failure, got %v", err)
	}
	form, authorizationHeader, basicID, basicSecret, _ := provider.recordedTokenRequest()
	if authorizationHeader == "" || basicID != testOIDCClientID || basicSecret != clientSecret || form.Get("client_secret") != "" {
		t.Fatalf("confidential client credentials were not sent using HTTP Basic")
	}
	for _, secret := range []string{code, form.Get("code_verifier"), clientSecret, accessToken, idToken} {
		if secret != "" && strings.Contains(err.Error(), secret) {
			t.Fatalf("callback error leaked %q: %v", secret, err)
		}
	}

	_, deniedQuery := beginOIDCLogin(t, party, provider, "/app")
	denied := url.Values{
		"state":             {deniedQuery.Get("state")},
		"error":             {"access_denied"},
		"error_description": {code + " " + clientSecret + " " + accessToken},
	}
	_, err = party.HandleCallback(context.Background(), denied, deniedQuery.Get("_browser_binding"))
	if !errors.Is(err, ErrAuthorizationFailed) {
		t.Fatalf("expected sanitized authorization failure, got %v", err)
	}
	for _, secret := range []string{code, clientSecret, accessToken} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("authorization error leaked %q: %v", secret, err)
		}
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("provider authorization error reached token endpoint: %d", provider.tokenCount.Load())
	}
}

func TestTokenExchangeUsesContextTimeout(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	party := newTestRelyingParty(t, provider, func(config *Config) {
		config.RequestTimeout = 30 * time.Millisecond
	})
	_, authorizationQuery := beginOIDCLogin(t, party, provider, "/app")
	provider.setResponder(func(writer http.ResponseWriter, request *http.Request, form url.Values) {
		<-request.Context().Done()
	})

	_, err := party.HandleCallback(context.Background(), callbackQuery(authorizationQuery, "timeout-code"), authorizationQuery.Get("_browser_binding"))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline, got %v", err)
	}
	if provider.tokenCount.Load() != 1 {
		t.Fatalf("unexpected timeout token request count: %d", provider.tokenCount.Load())
	}
}

func TestDiscoveryRejectsIssuerMismatchWithoutLeakingConfiguration(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	provider := newFakeOIDCProvider(t, clock)
	provider.mu.Lock()
	provider.discoveryIssuer = "https://different-issuer.invalid"
	provider.mu.Unlock()
	const secret = "discovery-client-secret"
	_, err := NewRelyingParty(context.Background(), Config{
		IssuerURL:      provider.server.URL,
		ClientID:       testOIDCClientID,
		ClientSecret:   secret,
		RedirectURL:    testOIDCRedirectURL,
		RequestTimeout: time.Second,
		HTTPClient:     provider.server.Client(),
		Now:            clock.Now,
	})
	if !errors.Is(err, ErrOIDCDiscovery) {
		t.Fatalf("expected discovery issuer mismatch, got %v", err)
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatal("discovery error leaked client secret")
	}
}

func signFakeIDToken(key *rsa.PrivateKey, claims map[string]any) (string, error) {
	header, err := json.Marshal(map[string]any{
		"alg": "RS256",
		"kid": "enterprise-test-key",
		"typ": "JWT",
	})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(cryptorand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func cloneValues(values url.Values) url.Values {
	if values == nil {
		return nil
	}
	cloned := make(url.Values, len(values))
	for key, entries := range values {
		cloned[key] = append([]string(nil), entries...)
	}
	return cloned
}

func cloneClaims(claims map[string]any) map[string]any {
	if claims == nil {
		return nil
	}
	cloned := make(map[string]any, len(claims))
	for key, value := range claims {
		cloned[key] = value
	}
	return cloned
}
