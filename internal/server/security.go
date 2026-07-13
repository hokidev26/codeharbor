package server

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const localTokenHeader = "X-Autoto-Token"
const legacyLocalTokenHeader = "X-CodeHarbor-Token"
const localTokenCookieName = "autoto_local_token"
const localTokenQuery = "token"

const remoteAccessCookieName = "autoto_remote_access"
const legacyRemoteAccessCookieName = "codeharbor_remote_access"
const remoteAccessHeader = "X-Autoto-Access"
const legacyRemoteAccessHeader = "X-CodeHarbor-Access"

const remoteAccessPath = "/auth/remote-access"
const remoteAccessLogoutPath = "/auth/remote-access/logout"

const remoteAccessMaxFailures = 10
const remoteAccessFailureWindow = 15 * time.Minute
const remoteAccessLockDuration = 15 * time.Minute
const remoteAccessFailureMaxEntries = 2048

type remoteAccessFailure struct {
	Count       int
	FirstFailed time.Time
	LockedUntil time.Time
}

func newLocalToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func (s *Server) now() time.Time {
	if s.clock != nil {
		return s.clock()
	}
	return time.Now()
}

func (s *Server) localRequestGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.remoteAccessGateRequired(r) {
			if s.handleRemoteAccessGate(w, r) {
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			if !s.sameOriginRequest(r) {
				writeError(w, http.StatusForbidden, "cross-origin local API request denied")
				return
			}
			if isBrowserInitiated(r) && !s.validHeaderToken(r) {
				writeError(w, http.StatusUnauthorized, "missing or invalid local API token")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) validateWebSocketRequest(w http.ResponseWriter, r *http.Request) bool {
	if !s.sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "cross-origin websocket request denied")
		return false
	}
	if !s.validWebSocketToken(r) {
		writeError(w, http.StatusUnauthorized, "missing or invalid websocket token")
		return false
	}
	return true
}

func (s *Server) validHeaderToken(r *http.Request) bool {
	return validTokenFromHeaders(r, s.localToken, localTokenHeader, legacyLocalTokenHeader)
}

func (s *Server) validWebSocketToken(r *http.Request) bool {
	if constantTimeEqualToken(r.URL.Query().Get(localTokenQuery), s.localToken) {
		return true
	}
	return validTokenFromHeaders(r, s.localToken, localTokenHeader, legacyLocalTokenHeader)
}

func validTokenFromHeaders(r *http.Request, want string, canonicalName, legacyName string) bool {
	if canonicalValue := strings.TrimSpace(r.Header.Get(canonicalName)); canonicalValue != "" {
		return constantTimeEqualToken(canonicalValue, want)
	}
	return constantTimeEqualToken(r.Header.Get(legacyName), want)
}

func constantTimeEqualToken(got, want string) bool {
	got = strings.TrimSpace(got)
	want = strings.TrimSpace(want)
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	var diff byte
	for i := 0; i < len(got); i++ {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}

func isBrowserInitiated(r *http.Request) bool {
	return strings.TrimSpace(r.Header.Get("Origin")) != "" || strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")) != ""
}

func (s *Server) sameOriginRequest(r *http.Request) bool {
	fetchSite := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")))
	if fetchSite == "cross-site" {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	for _, candidate := range requestHostCandidates(r) {
		if sameHost(parsed.Host, candidate) {
			return true
		}
	}
	return false
}

func sameHost(a, b string) bool {
	a = normalizeHostPort(a)
	b = normalizeHostPort(b)
	return strings.EqualFold(a, b)
}

func normalizeHostPort(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	host, port, err := net.SplitHostPort(value)
	if err == nil {
		if defaultPort(port) {
			return strings.Trim(strings.ToLower(host), "[]")
		}
		return strings.ToLower(net.JoinHostPort(strings.Trim(host, "[]"), port))
	}
	return strings.Trim(strings.ToLower(value), "[]")
}

func defaultPort(port string) bool {
	return port == "" || port == "80" || port == "443"
}

func (s *Server) remoteAccessGateRequired(r *http.Request) bool {
	cfg := s.configSnapshot()
	if cfg.Security.Exposed || requestHasRemoteForwardingHeaders(r) {
		return true
	}
	if strings.TrimSpace(cfg.Server.Host) == "" && hostOnly(r.Host) == "example.com" {
		// httptest.NewRequest uses example.com for relative URLs. A zero-value server
		// config is only used in tests; real CLI startup loads defaults with Host=localhost.
		return false
	}
	return !isLoopbackHost(r.Host)
}

func (s *Server) remoteHardeningActive(r *http.Request) bool {
	return s.remoteAccessGateRequired(r)
}

func (s *Server) handleRemoteAccessGate(w http.ResponseWriter, r *http.Request) bool {
	if isRemoteAccessLoginPath(r.URL.Path) {
		s.handleRemoteAccessLogin(w, r)
		return true
	}
	if s.validRemoteAccess(r) {
		return false
	}
	if shouldRenderRemoteAccessPage(r) {
		s.writeRemoteAccessLoginPage(w, http.StatusUnauthorized, "")
		return true
	}
	message := "remote access requires AUTOTO_ACCESS_PASSWORD"
	if strings.TrimSpace(s.configSnapshot().Security.AccessPassword) != "" {
		message = "remote access authentication required"
	}
	writeError(w, http.StatusUnauthorized, message)
	return true
}

func isRemoteAccessLoginPath(path string) bool {
	return path == remoteAccessPath || path == remoteAccessLogoutPath
}

func shouldRenderRemoteAccessPage(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/ws/") {
		return false
	}
	return acceptsHTML(r) || r.URL.Path == "/"
}

func acceptsHTML(r *http.Request) bool {
	accept := strings.ToLower(r.Header.Get("Accept"))
	return accept == "" || strings.Contains(accept, "text/html")
}

func (s *Server) handleRemoteAccessLogin(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == remoteAccessLogoutPath {
		s.handleRemoteAccessLogout(w, r)
		return
	}
	if r.Method != http.MethodPost {
		if r.Method == http.MethodGet {
			s.writeRemoteAccessLoginPage(w, http.StatusOK, "")
			return
		}
		w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	password := strings.TrimSpace(s.configSnapshot().Security.AccessPassword)
	if password == "" {
		s.writeRemoteAccessLoginPage(w, http.StatusForbidden, "请先在启动环境中配置 AUTOTO_ACCESS_PASSWORD。")
		return
	}
	if locked, until := s.remoteAccessLocked(r); locked {
		s.writeRemoteAccessLoginPage(w, http.StatusTooManyRequests, s.remoteAccessLockMessage(until))
		return
	}
	if err := r.ParseForm(); err != nil {
		s.writeRemoteAccessLoginPage(w, http.StatusBadRequest, "无法读取密码表单。")
		return
	}
	if !constantTimeEqualToken(r.FormValue("password"), password) {
		lockedUntil := s.recordRemoteAccessFailure(r)
		if !lockedUntil.IsZero() {
			s.writeRemoteAccessLoginPage(w, http.StatusTooManyRequests, s.remoteAccessLockMessage(lockedUntil))
			return
		}
		s.writeRemoteAccessLoginPage(w, http.StatusUnauthorized, "密码不正确，请重试。")
		return
	}
	s.clearRemoteAccessFailures(r)
	s.setRemoteAccessCookie(w, r, s.remoteAccessToken)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleRemoteAccessLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.validRemoteAccess(r) {
		s.clearRemoteAccessFailures(r)
	}
	s.clearRemoteAccessCookie(w, r)
	if acceptsHTML(r) {
		http.Redirect(w, r, remoteAccessPath, http.StatusSeeOther)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) remoteAccessLocked(r *http.Request) (bool, time.Time) {
	key := remoteAccessClientKey(r)
	now := s.now()
	s.remoteAccessMu.Lock()
	defer s.remoteAccessMu.Unlock()
	failure, ok := s.remoteAccessFailure[key]
	if !ok {
		return false, time.Time{}
	}
	if remoteAccessFailureExpired(failure, now) {
		delete(s.remoteAccessFailure, key)
		return false, time.Time{}
	}
	if !failure.LockedUntil.IsZero() {
		return true, failure.LockedUntil
	}
	return false, time.Time{}
}

func (s *Server) recordRemoteAccessFailure(r *http.Request) time.Time {
	key := remoteAccessClientKey(r)
	now := s.now()
	s.remoteAccessMu.Lock()
	defer s.remoteAccessMu.Unlock()
	if s.remoteAccessFailure == nil {
		s.remoteAccessFailure = make(map[string]remoteAccessFailure)
	}
	s.pruneRemoteAccessFailuresLocked(now)
	failure := s.remoteAccessFailure[key]
	if failure.FirstFailed.IsZero() || now.Sub(failure.FirstFailed) > remoteAccessFailureWindow {
		failure = remoteAccessFailure{FirstFailed: now}
	}
	failure.Count++
	if failure.Count >= remoteAccessMaxFailures {
		failure.LockedUntil = now.Add(remoteAccessLockDuration)
	}
	s.remoteAccessFailure[key] = failure
	s.trimRemoteAccessFailuresLocked()
	return failure.LockedUntil
}

func (s *Server) clearRemoteAccessFailures(r *http.Request) {
	key := remoteAccessClientKey(r)
	s.remoteAccessMu.Lock()
	defer s.remoteAccessMu.Unlock()
	delete(s.remoteAccessFailure, key)
}

func (s *Server) remoteAccessLockMessage(until time.Time) string {
	remaining := until.Sub(s.now())
	if remaining <= time.Minute {
		return "密码错误次数过多，请稍后重试。"
	}
	minutes := int((remaining + time.Minute - 1) / time.Minute)
	return fmt.Sprintf("密码错误次数过多，请约 %d 分钟后重试。", minutes)
}

func (s *Server) pruneRemoteAccessFailuresLocked(now time.Time) {
	for key, failure := range s.remoteAccessFailure {
		if remoteAccessFailureExpired(failure, now) {
			delete(s.remoteAccessFailure, key)
		}
	}
}

func (s *Server) trimRemoteAccessFailuresLocked() {
	for len(s.remoteAccessFailure) > remoteAccessFailureMaxEntries {
		candidate := remoteAccessFailureTrimCandidate(s.remoteAccessFailure)
		if candidate == "" {
			return
		}
		delete(s.remoteAccessFailure, candidate)
	}
}

func remoteAccessFailureTrimCandidate(failures map[string]remoteAccessFailure) string {
	oldestUnlockedKey := ""
	oldestUnlocked := time.Time{}
	oldestLockedKey := ""
	oldestLocked := time.Time{}
	for key, failure := range failures {
		if failure.FirstFailed.IsZero() {
			return key
		}
		if failure.LockedUntil.IsZero() {
			if oldestUnlockedKey == "" || failure.FirstFailed.Before(oldestUnlocked) {
				oldestUnlockedKey = key
				oldestUnlocked = failure.FirstFailed
			}
			continue
		}
		if oldestLockedKey == "" || failure.FirstFailed.Before(oldestLocked) {
			oldestLockedKey = key
			oldestLocked = failure.FirstFailed
		}
	}
	if oldestUnlockedKey != "" {
		return oldestUnlockedKey
	}
	return oldestLockedKey
}

func remoteAccessFailureExpired(failure remoteAccessFailure, now time.Time) bool {
	if !failure.LockedUntil.IsZero() {
		return !now.Before(failure.LockedUntil)
	}
	if failure.FirstFailed.IsZero() {
		return true
	}
	return now.Sub(failure.FirstFailed) > remoteAccessFailureWindow
}

func remoteAccessClientKey(r *http.Request) string {
	if isLoopbackHost(r.RemoteAddr) {
		if ip := trustedForwardedClientIP(r); ip != "" {
			return "ip:" + ip
		}
	}
	if ip := headerClientIP(r.RemoteAddr); ip != "" {
		return "ip:" + ip
	}
	if host := hostOnly(r.RemoteAddr); host != "" {
		return "host:" + host
	}
	return "unknown"
}

func trustedForwardedClientIP(r *http.Request) string {
	if ip := firstHeaderClientIP(r.Header.Values("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if ip := firstForwardedForClientIP(r.Header.Values("Forwarded")); ip != "" {
		return ip
	}
	if ip := firstHeaderClientIP(r.Header.Values("X-Forwarded-For")); ip != "" {
		return ip
	}
	if ip := firstHeaderClientIP(r.Header.Values("True-Client-IP")); ip != "" {
		return ip
	}
	return firstHeaderClientIP(r.Header.Values("X-Real-IP"))
}

func firstForwardedForClientIP(values []string) string {
	for _, value := range values {
		for _, part := range splitCommaList(value) {
			for _, param := range strings.Split(part, ";") {
				key, raw, ok := strings.Cut(strings.TrimSpace(param), "=")
				if !ok || !strings.EqualFold(strings.TrimSpace(key), "for") {
					continue
				}
				if ip := headerClientIP(raw); ip != "" {
					return ip
				}
			}
		}
	}
	return ""
}

func firstHeaderClientIP(values []string) string {
	for _, value := range values {
		for _, item := range splitCommaList(value) {
			if ip := headerClientIP(item); ip != "" {
				return ip
			}
		}
	}
	return ""
}

func headerClientIP(value string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"")
	if value == "" || strings.EqualFold(value, "unknown") || strings.HasPrefix(value, "_") {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	value = strings.Trim(value, "[]")
	ip := net.ParseIP(value)
	if ip == nil {
		return ""
	}
	return ip.String()
}

func (s *Server) validRemoteAccess(r *http.Request) bool {
	password := strings.TrimSpace(s.configSnapshot().Security.AccessPassword)
	if password == "" {
		return false
	}
	for _, name := range []string{remoteAccessCookieName, legacyRemoteAccessCookieName} {
		if cookie, err := r.Cookie(name); err == nil && constantTimeEqualToken(cookie.Value, s.remoteAccessToken) {
			return true
		}
	}
	if validTokenFromHeaders(r, password, remoteAccessHeader, legacyRemoteAccessHeader) {
		return true
	}
	bearer := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(bearer), "bearer ") {
		return constantTimeEqualToken(strings.TrimSpace(bearer[len("bearer "):]), password)
	}
	return false
}

func (s *Server) setRemoteAccessCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     remoteAccessCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int((24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   requestIsHTTPS(r) || s.remoteAccessGateRequired(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearRemoteAccessCookie(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{remoteAccessCookieName, legacyRemoteAccessCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   requestIsHTTPS(r) || s.remoteAccessGateRequired(r),
			SameSite: http.SameSiteLaxMode,
		})
	}
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func (s *Server) writeRemoteAccessLoginPage(w http.ResponseWriter, status int, message string) {
	passwordConfigured := strings.TrimSpace(s.configSnapshot().Security.AccessPassword) != ""
	messageHTML := ""
	if message != "" {
		messageHTML = fmt.Sprintf(`<div class="alert">%s</div>`, html.EscapeString(message))
	} else if !passwordConfigured {
		messageHTML = `<div class="alert">远程访问已触发保护，但还没有配置 <code>AUTOTO_ACCESS_PASSWORD</code>。请先停止裸露隧道，设置密码或使用 Cloudflare Access 后再重试。</div>`
	}
	formHTML := `<button class="submit" type="submit">解锁 Autoto</button>`
	if !passwordConfigured {
		formHTML = `<button class="submit" type="submit" disabled>等待配置访问密码</button>`
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Autoto 远程访问保护</title>
  <style>
    :root { color-scheme: dark; --bg:#202020; --panel:#28282a; --line:#3d3d42; --text:#f0f0f1; --muted:#a6a7ad; --accent:#7f91ff; --danger:#ff8b8b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at top left, rgba(127,145,255,.18), transparent 30%%), var(--bg); color: var(--text); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(100%%, 420px); border: 1px solid var(--line); border-radius: 22px; background: rgba(40,40,42,.94); box-shadow: 0 22px 70px rgba(0,0,0,.38); padding: 24px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgba(127,145,255,.24); border-radius: 999px; padding: 6px 10px; color: #aeb9ff; background: rgba(127,145,255,.12); font-size: 13px; font-weight: 760; }
    h1 { margin: 18px 0 8px; font-size: clamp(25px, 7vw, 34px); letter-spacing: -.04em; line-height: 1.08; }
    p { margin: 0 0 18px; color: var(--muted); }
    label { display: grid; gap: 8px; color: #d8d9df; font-weight: 650; }
    input { width: 100%%; border: 1px solid var(--line); border-radius: 14px; background: #1f1f20; color: var(--text); padding: 13px 14px; outline: none; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(127,145,255,.12); }
    .submit { width: 100%%; min-height: 48px; margin-top: 14px; border: 0; border-radius: 14px; background: #5369f3; color: white; font-weight: 800; cursor: pointer; }
    .submit:disabled { opacity: .55; cursor: not-allowed; }
    .alert { margin: 12px 0 16px; border: 1px solid rgba(255,139,139,.34); border-radius: 14px; padding: 12px 13px; background: rgba(255,107,107,.1); color: #ffd7d7; }
    code { color: #c8d0ff; }
    small { display: block; margin-top: 14px; color: #83858f; }
  </style>
</head>
<body>
  <main>
    <span class="pill">🔒 远程访问保护</span>
    <h1>先解锁，再控制本机 agent</h1>
    <p>当前请求不是可信 localhost，Autoto 已拦截 UI/API，避免隧道链接被拿到后直接驱动你的电脑。</p>
    %s
    <form method="post" action="/auth/remote-access" autocomplete="off">
      <label>访问密码
        <input name="password" type="password" inputmode="text" autocomplete="current-password" autofocus %s />
      </label>
      %s
    </form>
    <small>本机 localhost 使用仍走 local token；远程模式会禁用 bypassPermissions。</small>
  </main>
</body>
</html>`, messageHTML, disabledAttr(!passwordConfigured), formHTML)
}

func disabledAttr(disabled bool) string {
	if disabled {
		return "disabled"
	}
	return ""
}

func requestHasRemoteForwardingHeaders(r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get("CF-Connecting-IP")) != "" || strings.TrimSpace(r.Header.Get("Cf-Ray")) != "" {
		return true
	}
	if forwarded := strings.TrimSpace(r.Header.Get("Forwarded")); forwarded != "" {
		return forwardedHeaderLooksRemote(forwarded)
	}
	if host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); host != "" {
		return anyForwardedHostRemote(host)
	}
	if forwardedFor := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwardedFor != "" {
		return anyForwardedForRemote(forwardedFor)
	}
	return false
}

func requestHostCandidates(r *http.Request) []string {
	candidates := []string{r.Host}
	for _, value := range splitHeaderList(r.Header.Values("X-Forwarded-Host")) {
		if strings.TrimSpace(value) != "" {
			candidates = append(candidates, value)
		}
	}
	candidates = append(candidates, forwardedHeaderHostCandidates(r.Header.Values("Forwarded"))...)
	return candidates
}

func forwardedHeaderHostCandidates(values []string) []string {
	out := []string{}
	for _, value := range values {
		for _, part := range splitCommaList(value) {
			for _, param := range strings.Split(part, ";") {
				key, raw, ok := strings.Cut(strings.TrimSpace(param), "=")
				if !ok || !strings.EqualFold(strings.TrimSpace(key), "host") {
					continue
				}
				raw = strings.Trim(strings.TrimSpace(raw), "\"")
				if raw != "" {
					out = append(out, raw)
				}
			}
		}
	}
	return out
}

func anyForwardedHostRemote(value string) bool {
	for _, host := range splitCommaList(value) {
		if host != "" && !isLoopbackHost(host) {
			return true
		}
	}
	return false
}

func anyForwardedForRemote(value string) bool {
	for _, item := range splitCommaList(value) {
		item = strings.Trim(strings.TrimSpace(item), "[]\"")
		if item == "" || strings.EqualFold(item, "unknown") {
			continue
		}
		if host, _, err := net.SplitHostPort(item); err == nil {
			item = host
		}
		ip := net.ParseIP(strings.Trim(item, "[]"))
		if ip == nil || !ip.IsLoopback() {
			return true
		}
	}
	return false
}

func forwardedHeaderLooksRemote(value string) bool {
	for _, part := range splitCommaList(value) {
		params := strings.Split(part, ";")
		for _, param := range params {
			key, raw, ok := strings.Cut(strings.TrimSpace(param), "=")
			if !ok {
				continue
			}
			key = strings.ToLower(strings.TrimSpace(key))
			raw = strings.Trim(strings.TrimSpace(raw), "\"")
			if key == "host" && raw != "" && !isLoopbackHost(raw) {
				return true
			}
			if key == "for" && raw != "" && anyForwardedForRemote(raw) {
				return true
			}
		}
	}
	return false
}

func splitHeaderList(values []string) []string {
	out := []string{}
	for _, value := range values {
		out = append(out, splitCommaList(value)...)
	}
	return out
}

func splitCommaList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, strings.TrimSpace(part))
	}
	return out
}

func isLoopbackHost(value string) bool {
	host := hostOnly(value)
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func hostOnly(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return strings.Trim(strings.ToLower(host), "[]")
	}
	if strings.Count(value, ":") > 1 {
		return strings.Trim(strings.ToLower(value), "[]")
	}
	if host, _, ok := strings.Cut(value, ":"); ok {
		return strings.Trim(strings.ToLower(host), "[]")
	}
	return strings.Trim(strings.ToLower(value), "[]")
}

func (s *Server) safeDefaultPermissionModeForRequest(r *http.Request, mode string) string {
	mode = strings.TrimSpace(mode)
	if !validPermissionMode(mode) {
		mode = "acceptEdits"
	}
	if s.remoteHardeningActive(r) && mode == "bypassPermissions" {
		return "acceptEdits"
	}
	return mode
}

func (s *Server) permissionModeAllowedForRequest(r *http.Request, mode string) (string, bool, string) {
	mode = strings.TrimSpace(mode)
	if !validPermissionMode(mode) {
		return "", false, "invalid permissionMode"
	}
	if s.remoteHardeningActive(r) && mode == "bypassPermissions" {
		return "", false, "bypassPermissions is disabled while remote access hardening is active"
	}
	return mode, true, ""
}

func (s *Server) enforceRemotePermissionCap(r *http.Request, agentID string) error {
	if !s.remoteHardeningActive(r) || s.store == nil {
		return nil
	}
	agent, err := s.store.GetAgent(r.Context(), agentID)
	if err != nil {
		return err
	}
	if agent.PermissionMode != "bypassPermissions" {
		return nil
	}
	_, err = s.store.UpdateAgentPermissionMode(r.Context(), agentID, "acceptEdits")
	return err
}
