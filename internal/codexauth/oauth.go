package codexauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	OAuthClientID             = "app_EMoamEEZ73f0CkXaXp7hrann"
	OAuthIssuer               = "https://auth.openai.com"
	OAuthAuthorizeEndpoint    = OAuthIssuer + "/oauth/authorize"
	OAuthTokenEndpoint        = OAuthIssuer + "/oauth/token"
	OAuthScope                = "openid profile email offline_access api.connectors.read api.connectors.invoke"
	OAuthOriginator           = "codex_cli_rs"
	OAuthDefaultCallbackPort  = 1455
	OAuthFallbackCallbackPort = 1457

	oauthMaxTokenResponseBytes = 1 << 20
)

// OAuthConfig identifies the immutable OAuth issuer and public client. The
// production server uses OfficialOAuthConfig. LoopbackOAuthConfig exists only
// for explicit in-process tests and rejects every non-loopback issuer.
type OAuthConfig struct {
	Issuer     string
	ClientID   string
	HTTPClient *http.Client
}

type PKCE struct {
	Verifier  string
	Challenge string
}

type OAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
}

func OfficialOAuthConfig() OAuthConfig {
	return OAuthConfig{Issuer: OAuthIssuer, ClientID: OAuthClientID}
}

func LoopbackOAuthConfig(issuer, clientID string, client *http.Client) (OAuthConfig, error) {
	cfg := OAuthConfig{Issuer: strings.TrimSpace(issuer), ClientID: strings.TrimSpace(clientID), HTTPClient: client}
	parsed, err := parseOAuthIssuer(cfg.Issuer)
	if err != nil || !oauthLoopbackHost(parsed.Hostname()) {
		return OAuthConfig{}, errors.New("Codex OAuth 测试 issuer 必须是 loopback HTTP(S) 地址")
	}
	if cfg.ClientID == "" || strings.ContainsRune(cfg.ClientID, 0) {
		return OAuthConfig{}, errors.New("Codex OAuth 测试 client ID 无效")
	}
	return cfg, nil
}

func NewOAuthState() (string, error) {
	return oauthRandomURLString(32)
}

func NewPKCE() (PKCE, error) {
	verifier, err := oauthRandomURLString(32)
	if err != nil {
		return PKCE{}, err
	}
	challenge, err := PKCEChallenge(verifier)
	if err != nil {
		return PKCE{}, err
	}
	return PKCE{Verifier: verifier, Challenge: challenge}, nil
}

func PKCEChallenge(verifier string) (string, error) {
	verifier = strings.TrimSpace(verifier)
	if len(verifier) < 43 || len(verifier) > 128 {
		return "", errors.New("PKCE verifier 长度无效")
	}
	for _, char := range verifier {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || strings.ContainsRune("-._~", char) {
			continue
		}
		return "", errors.New("PKCE verifier 包含无效字符")
	}
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func BuildAuthorizeURL(cfg OAuthConfig, redirectURI, state, challenge string) (string, error) {
	issuer, clientID, err := normalizeOAuthConfig(cfg)
	if err != nil {
		return "", err
	}
	if _, err := parseOAuthRedirectURI(redirectURI); err != nil {
		return "", err
	}
	state = strings.TrimSpace(state)
	challenge = strings.TrimSpace(challenge)
	if state == "" || strings.ContainsRune(state, 0) {
		return "", errors.New("OAuth state 无效")
	}
	if challenge == "" || strings.ContainsRune(challenge, 0) {
		return "", errors.New("PKCE challenge 无效")
	}
	endpoint := *issuer
	endpoint.Path = "/oauth/authorize"
	query := endpoint.Query()
	query.Set("response_type", "code")
	query.Set("client_id", clientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("scope", OAuthScope)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("id_token_add_organizations", "true")
	query.Set("codex_cli_simplified_flow", "true")
	query.Set("state", state)
	query.Set("originator", OAuthOriginator)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}

// ExchangeAuthorizationCode exchanges a one-time authorization code without
// following redirects. Errors deliberately omit the code, verifier, token body,
// and upstream response text.
func ExchangeAuthorizationCode(ctx context.Context, cfg OAuthConfig, redirectURI, code, verifier string) (OAuthTokenResponse, error) {
	issuer, clientID, err := normalizeOAuthConfig(cfg)
	if err != nil {
		return OAuthTokenResponse{}, err
	}
	if _, err := parseOAuthRedirectURI(redirectURI); err != nil {
		return OAuthTokenResponse{}, err
	}
	code = strings.TrimSpace(code)
	verifier = strings.TrimSpace(verifier)
	if code == "" || strings.ContainsRune(code, 0) {
		return OAuthTokenResponse{}, errors.New("OAuth authorization code 无效")
	}
	if _, err := PKCEChallenge(verifier); err != nil {
		return OAuthTokenResponse{}, err
	}

	endpoint := *issuer
	endpoint.Path = "/oauth/token"
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return OAuthTokenResponse{}, errors.New("无法构造 Codex OAuth token 请求")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	client := oauthHTTPClient(cfg.HTTPClient)
	response, err := client.Do(request)
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return OAuthTokenResponse{}, ctx.Err()
		}
		return OAuthTokenResponse{}, errors.New("Codex OAuth token 请求失败")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return OAuthTokenResponse{}, fmt.Errorf("Codex OAuth token 交换失败（HTTP %d）", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, oauthMaxTokenResponseBytes+1))
	if err != nil || len(data) > oauthMaxTokenResponseBytes {
		return OAuthTokenResponse{}, errors.New("Codex OAuth token 响应无效")
	}
	var tokens OAuthTokenResponse
	if err := json.Unmarshal(data, &tokens); err != nil {
		return OAuthTokenResponse{}, errors.New("Codex OAuth token 响应无效")
	}
	tokens.AccessToken = strings.TrimSpace(tokens.AccessToken)
	tokens.RefreshToken = strings.TrimSpace(tokens.RefreshToken)
	tokens.IDToken = strings.TrimSpace(tokens.IDToken)
	tokens.TokenType = strings.TrimSpace(tokens.TokenType)
	if tokens.AccessToken == "" {
		return OAuthTokenResponse{}, errors.New("Codex OAuth token 响应缺少 access_token")
	}
	return tokens, nil
}

func oauthRandomURLString(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, buffer); err != nil {
		return "", errors.New("无法生成安全随机 OAuth 参数")
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func normalizeOAuthConfig(cfg OAuthConfig) (*url.URL, string, error) {
	issuer := strings.TrimSpace(cfg.Issuer)
	clientID := strings.TrimSpace(cfg.ClientID)
	if issuer == "" {
		issuer = OAuthIssuer
	}
	if clientID == "" {
		clientID = OAuthClientID
	}
	parsed, err := parseOAuthIssuer(issuer)
	if err != nil {
		return nil, "", err
	}
	if issuer != OAuthIssuer && !oauthLoopbackHost(parsed.Hostname()) {
		return nil, "", errors.New("Codex OAuth issuer 仅允许官方地址或显式 loopback 测试地址")
	}
	if clientID == "" || strings.ContainsRune(clientID, 0) {
		return nil, "", errors.New("Codex OAuth client ID 无效")
	}
	return parsed, clientID, nil
}

func parseOAuthIssuer(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Opaque != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != "" {
		return nil, errors.New("Codex OAuth issuer 无效")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("Codex OAuth issuer 必须使用 HTTP(S)")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, errors.New("Codex OAuth issuer 不得包含路径")
	}
	parsed.Path = ""
	return parsed, nil
}

func parseOAuthRedirectURI(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || parsed.Opaque != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != "" {
		return nil, errors.New("Codex OAuth redirect URI 无效")
	}
	if !oauthLoopbackHost(parsed.Hostname()) || parsed.Port() == "" || parsed.Path == "" {
		return nil, errors.New("Codex OAuth redirect URI 必须是带端口的 loopback HTTP 地址")
	}
	return parsed, nil
}

func oauthLoopbackHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func oauthHTTPClient(configured *http.Client) *http.Client {
	client := &http.Client{Timeout: 30 * time.Second}
	if configured != nil {
		copy := *configured
		client = &copy
		if client.Timeout <= 0 {
			client.Timeout = 30 * time.Second
		}
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return client
}
