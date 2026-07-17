package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"autoto/internal/codexauth"

	"github.com/go-chi/chi/v5"
)

const (
	codexOAuthLoginTTL          = 10 * time.Minute
	codexOAuthCallbackPath      = "/auth/callback"
	codexOAuthCallbackHost      = "localhost"
	codexOAuthCallbackCSP       = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
	codexOAuthCallbackMaxWait   = 5 * time.Second
	codexOAuthLoginIDPrefix     = "codex_login_"
	codexOAuthLoginErrorMessage = "Codex OAuth 登录失败，请重新开始登录"
)

type codexOAuthLoginStatus string

const (
	codexOAuthLoginPending    codexOAuthLoginStatus = "pending"
	codexOAuthLoginExchanging codexOAuthLoginStatus = "exchanging"
	codexOAuthLoginCompleted  codexOAuthLoginStatus = "completed"
	codexOAuthLoginFailed     codexOAuthLoginStatus = "failed"
	codexOAuthLoginCancelled  codexOAuthLoginStatus = "cancelled"
	codexOAuthLoginExpired    codexOAuthLoginStatus = "expired"
)

type codexOAuthLoginSession struct {
	loginID      string
	state        string
	verifier     string
	authURL      string
	redirectURI  string
	status       codexOAuthLoginStatus
	expiresAt    time.Time
	errorMessage string
	account      *codexauth.AccountSummary
	oauthConfig  codexauth.OAuthConfig
	listener     net.Listener
	server       *http.Server
	cancel       context.CancelFunc
	ctx          context.Context
}

type codexOAuthLoginTestConfig struct {
	Issuer        string
	ClientID      string
	ListenAddress string
	HTTPClient    *http.Client
	SessionTTL    time.Duration
}

type codexOAuthLoginResponse struct {
	LoginID   string                    `json:"loginId"`
	AuthURL   string                    `json:"authUrl,omitempty"`
	ExpiresAt string                    `json:"expiresAt"`
	Status    codexOAuthLoginStatus     `json:"status"`
	Error     string                    `json:"error,omitempty"`
	Account   *codexauth.AccountSummary `json:"account,omitempty"`
}

type codexOAuthRuntimeConfig struct {
	oauth           codexauth.OAuthConfig
	listenAddresses []string
	ttl             time.Duration
}

func (s *Server) startCodexOAuthLogin(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if s.rejectRemoteCodexOAuthLogin(w, r) {
		return
	}

	s.codexOAuthMu.Lock()
	defer s.codexOAuthMu.Unlock()
	s.expireCodexOAuthLoginLocked(s.now())
	if session := s.codexOAuthLogin; session != nil && (session.status == codexOAuthLoginPending || session.status == codexOAuthLoginExchanging) {
		setNoStore(w)
		writeJSON(w, http.StatusOK, codexOAuthLoginPublicResponse(session, true))
		return
	}

	runtimeConfig, err := s.codexOAuthRuntimeConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Codex OAuth 登录配置无效")
		return
	}
	listener, err := listenCodexOAuthCallback(runtimeConfig.listenAddresses)
	if err != nil {
		writeError(w, http.StatusConflict, "无法监听 Codex OAuth 本地回调端口")
		return
	}

	loginRandom, err := codexauth.NewOAuthState()
	if err != nil {
		listener.Close()
		writeError(w, http.StatusInternalServerError, "无法安全启动 Codex OAuth 登录")
		return
	}
	state, err := codexauth.NewOAuthState()
	if err != nil {
		listener.Close()
		writeError(w, http.StatusInternalServerError, "无法安全启动 Codex OAuth 登录")
		return
	}
	pkce, err := codexauth.NewPKCE()
	if err != nil {
		listener.Close()
		writeError(w, http.StatusInternalServerError, "无法安全启动 Codex OAuth 登录")
		return
	}
	port, err := listenerPort(listener)
	if err != nil {
		listener.Close()
		writeError(w, http.StatusInternalServerError, "Codex OAuth 本地回调地址无效")
		return
	}
	redirectURI := fmt.Sprintf("http://%s:%d%s", codexOAuthCallbackHost, port, codexOAuthCallbackPath)
	authURL, err := codexauth.BuildAuthorizeURL(runtimeConfig.oauth, redirectURI, state, pkce.Challenge)
	if err != nil {
		listener.Close()
		writeError(w, http.StatusInternalServerError, "无法构造 Codex OAuth 授权地址")
		return
	}

	now := s.now().UTC()
	ctx, cancel := context.WithCancel(context.Background())
	session := &codexOAuthLoginSession{
		loginID:     codexOAuthLoginIDPrefix + loginRandom,
		state:       state,
		verifier:    pkce.Verifier,
		authURL:     authURL,
		redirectURI: redirectURI,
		status:      codexOAuthLoginPending,
		expiresAt:   now.Add(runtimeConfig.ttl),
		oauthConfig: runtimeConfig.oauth,
		listener:    listener,
		cancel:      cancel,
		ctx:         ctx,
	}
	mux := http.NewServeMux()
	mux.HandleFunc(codexOAuthCallbackPath, func(callbackWriter http.ResponseWriter, callbackRequest *http.Request) {
		s.handleCodexOAuthCallback(session, callbackWriter, callbackRequest)
	})
	session.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       15 * time.Second,
	}
	s.codexOAuthLogin = session
	go s.serveCodexOAuthCallback(session)
	go s.expireCodexOAuthLoginAfter(session, runtimeConfig.ttl)

	setNoStore(w)
	writeJSON(w, http.StatusOK, codexOAuthLoginPublicResponse(session, true))
}

func (s *Server) getCodexOAuthLogin(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if s.rejectRemoteCodexOAuthLogin(w, r) {
		return
	}
	s.codexOAuthMu.Lock()
	defer s.codexOAuthMu.Unlock()
	s.expireCodexOAuthLoginLocked(s.now())
	session := s.codexOAuthLogin
	if session == nil || session.loginID != strings.TrimSpace(chi.URLParam(r, "loginId")) {
		writeError(w, http.StatusNotFound, "Codex OAuth 登录会话不存在")
		return
	}
	setNoStore(w)
	writeJSON(w, http.StatusOK, codexOAuthLoginPublicResponse(session, false))
}

func (s *Server) cancelCodexOAuthLogin(w http.ResponseWriter, r *http.Request) {
	setNoStore(w)
	if s.rejectRemoteCodexOAuthLogin(w, r) {
		return
	}
	s.codexOAuthMu.Lock()
	defer s.codexOAuthMu.Unlock()
	s.expireCodexOAuthLoginLocked(s.now())
	session := s.codexOAuthLogin
	if session == nil || session.loginID != strings.TrimSpace(chi.URLParam(r, "loginId")) {
		writeError(w, http.StatusNotFound, "Codex OAuth 登录会话不存在")
		return
	}
	if session.status == codexOAuthLoginPending || session.status == codexOAuthLoginExchanging {
		s.finishCodexOAuthLoginLocked(session, codexOAuthLoginCancelled, "", nil)
	}
	setNoStore(w)
	writeJSON(w, http.StatusOK, codexOAuthLoginPublicResponse(session, false))
}

func (s *Server) rejectRemoteCodexOAuthLogin(w http.ResponseWriter, r *http.Request) bool {
	if s.remoteAccessAuthentication(r).Remote {
		writeError(w, http.StatusForbidden, "Codex OAuth 登录只能在本机发起和管理")
		return true
	}
	return false
}

func (s *Server) handleCodexOAuthCallback(session *codexOAuthLoginSession, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeCodexOAuthCallbackHTML(w, http.StatusMethodNotAllowed, "请求方法无效", "Codex OAuth 回调只接受 GET 请求。")
		return
	}
	if !validCodexOAuthCallbackHost(r.Host, session.listener.Addr()) {
		writeCodexOAuthCallbackHTML(w, http.StatusBadRequest, "回调地址无效", "本地 OAuth 回调 Host 校验失败。")
		return
	}

	state := r.URL.Query().Get("state")
	s.codexOAuthMu.Lock()
	s.expireCodexOAuthLoginLocked(s.now())
	if s.codexOAuthLogin != session {
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackHTML(w, http.StatusGone, "登录会话已结束", "此 OAuth 登录会话已不再有效。")
		return
	}
	if session.status != codexOAuthLoginPending {
		status := session.status
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackStatusHTML(w, status)
		return
	}
	if !constantTimeEqualToken(state, session.state) {
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackHTML(w, http.StatusBadRequest, "登录校验失败", "OAuth state 校验失败，请返回 Autoto 重新开始登录。")
		return
	}
	if oauthError := safeCodexOAuthErrorCode(r.URL.Query().Get("error")); oauthError != "" {
		message := "Codex 授权被拒绝"
		if oauthError != "oauth_error" {
			message += "（" + oauthError + "）"
		}
		s.finishCodexOAuthLoginLocked(session, codexOAuthLoginFailed, message, nil)
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackHTML(w, http.StatusBadRequest, "Codex 登录失败", message+"。")
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" || len(code) > 8192 {
		s.finishCodexOAuthLoginLocked(session, codexOAuthLoginFailed, codexOAuthLoginErrorMessage, nil)
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackHTML(w, http.StatusBadRequest, "Codex 登录失败", "授权回调缺少 authorization code，请重新开始登录。")
		return
	}
	session.status = codexOAuthLoginExchanging
	oauthConfig := session.oauthConfig
	redirectURI := session.redirectURI
	verifier := session.verifier
	s.codexOAuthMu.Unlock()

	tokens, err := codexauth.ExchangeAuthorizationCode(session.ctx, oauthConfig, redirectURI, code, verifier)
	if err != nil {
		s.codexOAuthMu.Lock()
		if s.codexOAuthLogin == session && session.status == codexOAuthLoginExchanging {
			s.finishCodexOAuthLoginLocked(session, codexOAuthLoginFailed, codexOAuthLoginErrorMessage, nil)
			status := session.status
			s.codexOAuthMu.Unlock()
			writeCodexOAuthCallbackStatusHTML(w, status)
			return
		}
		status := session.status
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackStatusHTML(w, status)
		return
	}

	s.codexOAuthMu.Lock()
	if s.codexOAuthLogin != session || session.status != codexOAuthLoginExchanging {
		status := session.status
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackStatusHTML(w, status)
		return
	}
	account, importErr := s.importCodexOAuthTokensLocked(tokens)
	if importErr != nil {
		s.finishCodexOAuthLoginLocked(session, codexOAuthLoginFailed, codexOAuthLoginErrorMessage, nil)
		s.codexOAuthMu.Unlock()
		writeCodexOAuthCallbackHTML(w, http.StatusInternalServerError, "Codex 登录失败", "凭据无法安全保存，请返回 Autoto 重试。")
		return
	}
	s.finishCodexOAuthLoginLocked(session, codexOAuthLoginCompleted, "", account)
	s.codexOAuthMu.Unlock()
	writeCodexOAuthCallbackHTML(w, http.StatusOK, "Codex 登录成功", "凭据已安全保存，可以关闭此页面并返回 Autoto。")
}

func (s *Server) importCodexOAuthTokensLocked(tokens codexauth.OAuthTokenResponse) (*codexauth.AccountSummary, error) {
	now := s.now().UTC()
	standard := map[string]any{
		"type":         codexauth.DefaultProviderName,
		"access_token": tokens.AccessToken,
		"last_refresh": now.Format(time.RFC3339),
		"websockets":   false,
		"disabled":     false,
	}
	if tokens.RefreshToken != "" {
		standard["refresh_token"] = tokens.RefreshToken
	}
	if tokens.IDToken != "" {
		standard["id_token"] = tokens.IDToken
	}
	if tokens.ExpiresIn > 0 {
		standard["expired"] = now.Add(time.Duration(tokens.ExpiresIn) * time.Second).Format(time.RFC3339)
	}
	content, err := json.Marshal(standard)
	if err != nil {
		return nil, errors.New("无法构造 Codex OAuth 凭据")
	}
	plan, err := buildProviderAuthImportPlan("autoto-codex-oauth.json", string(content), now)
	if err != nil {
		return nil, errors.New("Codex OAuth 凭据无效")
	}
	store, err := s.nativeCodexCredentialStore()
	if err != nil {
		return nil, err
	}
	documents := make([]codexauth.ImportDocument, 0, len(plan.Files))
	for _, file := range plan.Files {
		documents = append(documents, codexauth.ImportDocument{Filename: file.Filename, Content: file.Content})
	}
	stored, err := store.Import(documents)
	if err != nil {
		return nil, err
	}
	if err := s.ensureNativeCodexProvider(); err != nil {
		return nil, err
	}
	return findImportedCodexAccount(store, plan.Files, stored.Files)
}

func findImportedCodexAccount(store *codexauth.Store, planned []providerAuthImportFile, storedFiles []string) (*codexauth.AccountSummary, error) {
	accounts, err := store.ListAccounts()
	if err != nil {
		return nil, err
	}
	storedNames := make(map[string]struct{}, len(storedFiles))
	for _, name := range storedFiles {
		storedNames[name] = struct{}{}
	}
	for _, account := range accounts {
		if _, ok := storedNames[account.Name]; ok {
			copy := account
			return &copy, nil
		}
	}
	var accountID, email string
	for _, file := range planned {
		var credential map[string]any
		if json.Unmarshal(file.Content, &credential) == nil {
			if accountID == "" {
				accountID = authImportString(credential, "account_id")
			}
			if email == "" {
				email = authImportString(credential, "email")
			}
		}
	}
	for _, account := range accounts {
		if (accountID != "" && strings.EqualFold(account.AccountID, accountID)) || (accountID == "" && email != "" && strings.EqualFold(account.Email, email)) {
			copy := account
			return &copy, nil
		}
	}
	return nil, nil
}

func (s *Server) codexOAuthRuntimeConfig() (codexOAuthRuntimeConfig, error) {
	if s.codexOAuthTestConfig == nil {
		return codexOAuthRuntimeConfig{
			oauth: codexauth.OfficialOAuthConfig(),
			listenAddresses: []string{
				net.JoinHostPort("127.0.0.1", strconv.Itoa(codexauth.OAuthDefaultCallbackPort)),
				net.JoinHostPort("127.0.0.1", strconv.Itoa(codexauth.OAuthFallbackCallbackPort)),
			},
			ttl: codexOAuthLoginTTL,
		}, nil
	}
	testConfig := s.codexOAuthTestConfig
	if strings.TrimSpace(testConfig.Issuer) == "" || strings.TrimSpace(testConfig.ClientID) == "" || strings.TrimSpace(testConfig.ListenAddress) == "" {
		return codexOAuthRuntimeConfig{}, errors.New("Codex OAuth 测试配置必须显式提供 issuer、client ID 和 listen address")
	}
	oauthConfig, err := codexauth.LoopbackOAuthConfig(testConfig.Issuer, testConfig.ClientID, testConfig.HTTPClient)
	if err != nil {
		return codexOAuthRuntimeConfig{}, err
	}
	if err := validateCodexOAuthListenAddress(testConfig.ListenAddress); err != nil {
		return codexOAuthRuntimeConfig{}, err
	}
	ttl := testConfig.SessionTTL
	if ttl <= 0 {
		ttl = codexOAuthLoginTTL
	}
	return codexOAuthRuntimeConfig{oauth: oauthConfig, listenAddresses: []string{testConfig.ListenAddress}, ttl: ttl}, nil
}

func validateCodexOAuthListenAddress(address string) error {
	host, port, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("Codex OAuth 测试 listen address 必须是 loopback IP:port")
	}
	value, err := strconv.Atoi(port)
	if err != nil || value < 0 || value > 65535 {
		return errors.New("Codex OAuth 测试 listen port 无效")
	}
	return nil
}

func listenCodexOAuthCallback(addresses []string) (net.Listener, error) {
	var lastErr error
	for _, address := range addresses {
		listener, err := net.Listen("tcp4", address)
		if err == nil {
			return listener, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("没有可用的 Codex OAuth 回调地址")
	}
	return nil, lastErr
}

func listenerPort(listener net.Listener) (int, error) {
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || address.Port <= 0 {
		return 0, errors.New("Codex OAuth callback listener address 无效")
	}
	return address.Port, nil
}

func validCodexOAuthCallbackHost(value string, listenerAddress net.Addr) bool {
	expectedPort, err := listenerPortFromAddress(listenerAddress)
	if err != nil {
		return false
	}
	host := strings.TrimSpace(value)
	port := ""
	if parsedHost, parsedPort, splitErr := net.SplitHostPort(host); splitErr == nil {
		host, port = parsedHost, parsedPort
	} else if strings.Contains(host, ":") {
		return false
	}
	host = strings.ToLower(strings.TrimSpace(host))
	if host != "localhost" && host != "127.0.0.1" {
		return false
	}
	return port != "" && port == strconv.Itoa(expectedPort)
}

func listenerPortFromAddress(address net.Addr) (int, error) {
	if tcp, ok := address.(*net.TCPAddr); ok && tcp.Port > 0 {
		return tcp.Port, nil
	}
	_, port, err := net.SplitHostPort(address.String())
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(port)
}

func (s *Server) serveCodexOAuthCallback(session *codexOAuthLoginSession) {
	err := session.server.Serve(session.listener)
	if err == nil || errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
		return
	}
	s.codexOAuthMu.Lock()
	defer s.codexOAuthMu.Unlock()
	if s.codexOAuthLogin == session && (session.status == codexOAuthLoginPending || session.status == codexOAuthLoginExchanging) {
		s.finishCodexOAuthLoginLocked(session, codexOAuthLoginFailed, codexOAuthLoginErrorMessage, nil)
	}
}

func (s *Server) expireCodexOAuthLoginAfter(session *codexOAuthLoginSession, ttl time.Duration) {
	timer := time.NewTimer(ttl)
	defer timer.Stop()
	select {
	case <-timer.C:
		s.codexOAuthMu.Lock()
		if s.codexOAuthLogin == session && (session.status == codexOAuthLoginPending || session.status == codexOAuthLoginExchanging) {
			s.finishCodexOAuthLoginLocked(session, codexOAuthLoginExpired, "", nil)
		}
		s.codexOAuthMu.Unlock()
	case <-session.ctx.Done():
	}
}

func (s *Server) expireCodexOAuthLoginLocked(now time.Time) {
	session := s.codexOAuthLogin
	if session == nil || now.Before(session.expiresAt) || session.status != codexOAuthLoginPending && session.status != codexOAuthLoginExchanging {
		return
	}
	s.finishCodexOAuthLoginLocked(session, codexOAuthLoginExpired, "", nil)
}

func (s *Server) finishCodexOAuthLoginLocked(session *codexOAuthLoginSession, status codexOAuthLoginStatus, message string, account *codexauth.AccountSummary) {
	if session == nil {
		return
	}
	session.status = status
	session.errorMessage = message
	session.account = account
	// Terminal sessions retain only public status metadata. State, PKCE material,
	// and the authorize URL are one-time secrets and must not remain reachable.
	session.state = ""
	session.verifier = ""
	session.authURL = ""
	session.redirectURI = ""
	if session.cancel != nil {
		session.cancel()
	}
	if session.server != nil {
		go shutdownCodexOAuthCallback(session.server)
	} else if session.listener != nil {
		_ = session.listener.Close()
	}
}

func shutdownCodexOAuthCallback(server *http.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), codexOAuthCallbackMaxWait)
	defer cancel()
	_ = server.Shutdown(ctx)
}

func codexOAuthLoginPublicResponse(session *codexOAuthLoginSession, includeAuthURL bool) codexOAuthLoginResponse {
	response := codexOAuthLoginResponse{
		LoginID:   session.loginID,
		ExpiresAt: session.expiresAt.UTC().Format(time.RFC3339),
		Status:    session.status,
		Error:     session.errorMessage,
		Account:   session.account,
	}
	if includeAuthURL {
		response.AuthURL = session.authURL
	}
	return response
}

func safeCodexOAuthErrorCode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	switch value {
	case "access_denied", "invalid_request", "unauthorized_client", "unsupported_response_type", "invalid_scope", "server_error", "temporarily_unavailable":
		return value
	default:
		return "oauth_error"
	}
}

func writeCodexOAuthCallbackStatusHTML(w http.ResponseWriter, status codexOAuthLoginStatus) {
	switch status {
	case codexOAuthLoginCompleted:
		writeCodexOAuthCallbackHTML(w, http.StatusOK, "Codex 登录成功", "凭据已安全保存，可以关闭此页面并返回 Autoto。")
	case codexOAuthLoginCancelled:
		writeCodexOAuthCallbackHTML(w, http.StatusGone, "登录已取消", "此 Codex OAuth 登录会话已取消。")
	case codexOAuthLoginExpired:
		writeCodexOAuthCallbackHTML(w, http.StatusGone, "登录已过期", "此 Codex OAuth 登录会话已过期，请返回 Autoto 重新开始。")
	default:
		writeCodexOAuthCallbackHTML(w, http.StatusBadRequest, "Codex 登录失败", "登录未能完成，请返回 Autoto 重新开始。")
	}
}

func writeCodexOAuthCallbackHTML(w http.ResponseWriter, status int, title, message string) {
	setNoStore(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", codexOAuthCallbackCSP)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>%s</title></head><body><main><h1>%s</h1><p>%s</p></main></body></html>", html.EscapeString(title), html.EscapeString(title), html.EscapeString(message))
}
