package codexauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOAuthPKCEAndAuthorizeURL(t *testing.T) {
	state, err := NewOAuthState()
	if err != nil {
		t.Fatal(err)
	}
	pkce, err := NewPKCE()
	if err != nil {
		t.Fatal(err)
	}
	if len(state) < 43 || len(pkce.Verifier) < 43 || len(pkce.Challenge) != 43 {
		t.Fatalf("unexpected OAuth entropy lengths: state=%d verifier=%d challenge=%d", len(state), len(pkce.Verifier), len(pkce.Challenge))
	}
	digest := sha256.Sum256([]byte(pkce.Verifier))
	if want := base64.RawURLEncoding.EncodeToString(digest[:]); pkce.Challenge != want {
		t.Fatalf("unexpected S256 challenge: got %q want %q", pkce.Challenge, want)
	}

	authURL, err := BuildAuthorizeURL(OfficialOAuthConfig(), "http://localhost:1455/auth/callback", state, pkce.Challenge)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme+"://"+parsed.Host+parsed.Path != OAuthAuthorizeEndpoint {
		t.Fatalf("unexpected authorize endpoint: %s", parsed)
	}
	query := parsed.Query()
	want := map[string]string{
		"response_type":              "code",
		"client_id":                  OAuthClientID,
		"redirect_uri":               "http://localhost:1455/auth/callback",
		"scope":                      OAuthScope,
		"code_challenge":             pkce.Challenge,
		"code_challenge_method":      "S256",
		"id_token_add_organizations": "true",
		"codex_cli_simplified_flow":  "true",
		"state":                      state,
		"originator":                 OAuthOriginator,
	}
	for key, value := range want {
		if query.Get(key) != value {
			t.Fatalf("authorize parameter %s mismatch: got %q want %q", key, query.Get(key), value)
		}
	}
	if len(query) != len(want) {
		t.Fatalf("unexpected authorize parameters: %v", query)
	}
}

func TestExchangeAuthorizationCodeUsesFormAndRejectsRedirectsWithoutLeaks(t *testing.T) {
	const (
		code        = "authorization-code-fixture"
		access      = "access-token-fixture"
		refresh     = "refresh-token-fixture"
		idToken     = "id-token-fixture"
		verifier    = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
		redirectURI = "http://localhost:1455/auth/callback"
	)
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	var tokenRequests atomic.Int32
	issuer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth/token" {
			http.NotFound(w, r)
			return
		}
		tokenRequests.Add(1)
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			t.Fatalf("unexpected token request: method=%s content-type=%q", r.Method, r.Header.Get("Content-Type"))
		}
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		form, err := url.ParseQuery(string(data))
		if err != nil {
			t.Fatal(err)
		}
		for key, want := range map[string]string{
			"grant_type":    "authorization_code",
			"client_id":     "fixture-client",
			"code":          code,
			"code_verifier": verifier,
			"redirect_uri":  redirectURI,
		} {
			if form.Get(key) != want {
				t.Fatalf("token form %s mismatch: got %q want %q", key, form.Get(key), want)
			}
		}
		_, _ = w.Write([]byte(`{"access_token":"` + access + `","refresh_token":"` + refresh + `","id_token":"` + idToken + `","expires_in":3600,"token_type":"Bearer"}`))
	}))
	defer issuer.Close()
	cfg, err := LoopbackOAuthConfig(issuer.URL, "fixture-client", issuer.Client())
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := ExchangeAuthorizationCode(context.Background(), cfg, redirectURI, code, verifier)
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken != access || tokens.RefreshToken != refresh || tokens.IDToken != idToken || tokens.ExpiresIn != 3600 {
		t.Fatalf("unexpected token response: %+v", tokens)
	}
	if tokenRequests.Load() != 1 {
		t.Fatalf("expected one token request, got %d", tokenRequests.Load())
	}

	redirectingIssuer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/capture", http.StatusTemporaryRedirect)
	}))
	defer redirectingIssuer.Close()
	redirectCfg, err := LoopbackOAuthConfig(redirectingIssuer.URL, "fixture-client", redirectingIssuer.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = ExchangeAuthorizationCode(context.Background(), redirectCfg, redirectURI, code, verifier)
	if err == nil {
		t.Fatal("expected redirecting token endpoint to fail")
	}
	for _, secret := range []string{code, verifier, access, refresh, idToken} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("OAuth exchange error leaked secret %q: %v", secret, err)
		}
	}
	if redirected.Load() != 0 {
		t.Fatal("token exchange followed a redirect")
	}
}

func TestLoopbackOAuthConfigRejectsNonLoopbackIssuer(t *testing.T) {
	if _, err := LoopbackOAuthConfig("https://example.test", "fixture-client", nil); err == nil {
		t.Fatal("expected non-loopback issuer rejection")
	}
}
