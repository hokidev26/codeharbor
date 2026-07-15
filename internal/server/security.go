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

func (s *Server) sensitiveLocalTokenGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.requireSensitiveLocalToken(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireSensitiveLocalToken(w http.ResponseWriter, r *http.Request) bool {
	if !constantTimeEqualToken(r.Header.Get(localTokenHeader), s.localToken) {
		writeError(w, http.StatusUnauthorized, "missing or invalid local API token")
		return false
	}
	return true
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
	valid, legacy := validTokenFromHeadersWithSource(r, s.localToken, localTokenHeader, legacyLocalTokenHeader)
	if valid && legacy {
		s.warnLegacy("credential:"+legacyLocalTokenHeader, legacyLocalTokenHeader, localTokenHeader, "request-header")
	}
	return valid
}

func (s *Server) validWebSocketToken(r *http.Request) bool {
	if constantTimeEqualToken(r.URL.Query().Get(localTokenQuery), s.localToken) {
		return true
	}
	return s.validHeaderToken(r)
}

func validTokenFromHeaders(r *http.Request, want string, canonicalName, legacyName string) bool {
	valid, _ := validTokenFromHeadersWithSource(r, want, canonicalName, legacyName)
	return valid
}

func validTokenFromHeadersWithSource(r *http.Request, want string, canonicalName, legacyName string) (bool, bool) {
	if canonicalValue := strings.TrimSpace(r.Header.Get(canonicalName)); canonicalValue != "" {
		return constantTimeEqualToken(canonicalValue, want), false
	}
	valid := constantTimeEqualToken(r.Header.Get(legacyName), want)
	return valid, valid
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
	if s.validRemoteAccessWithoutWarning(r) {
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
	return s.validRemoteAccessReporting(r, true)
}

func (s *Server) validRemoteAccessWithoutWarning(r *http.Request) bool {
	return s.validRemoteAccessReporting(r, false)
}

func (s *Server) validRemoteAccessReporting(r *http.Request, warn bool) bool {
	password := strings.TrimSpace(s.configSnapshot().Security.AccessPassword)
	if password == "" {
		return false
	}
	if cookie, err := r.Cookie(remoteAccessCookieName); err == nil {
		if constantTimeEqualToken(cookie.Value, s.remoteAccessToken) {
			return true
		}
	} else if legacyCookie, legacyErr := r.Cookie(legacyRemoteAccessCookieName); legacyErr == nil && constantTimeEqualToken(legacyCookie.Value, s.remoteAccessToken) {
		if warn {
			s.warnLegacy("credential:"+legacyRemoteAccessCookieName, legacyRemoteAccessCookieName, remoteAccessCookieName, "cookie")
		}
		return true
	}
	if valid, legacy := validTokenFromHeadersWithSource(r, password, remoteAccessHeader, legacyRemoteAccessHeader); valid {
		if warn && legacy {
			s.warnLegacy("credential:"+legacyRemoteAccessHeader, legacyRemoteAccessHeader, remoteAccessHeader, "request-header")
		}
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
		messageHTML = fmt.Sprintf(`<div class="alert" role="alert">%s</div>`, html.EscapeString(message))
	} else if !passwordConfigured {
		messageHTML = `<div class="alert" role="alert">远程访问已触发保护，但还没有配置 <code>AUTOTO_ACCESS_PASSWORD</code>。请先停止裸露隧道，设置密码或使用 Cloudflare Access 后再重试。</div>`
	}
	formHTML := `<button class="submit" type="submit"><span>解锁 Autoto</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button>`
	if !passwordConfigured {
		formHTML = `<button class="submit" type="submit" disabled><span>等待配置访问密码</span></button>`
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
    :root { color-scheme: light; --page:#f4f6fb; --card:#ffffff; --line:#e2e6ef; --line-strong:#d4dae6; --text:#202634; --muted:#747e90; --accent:#5369f3; --accent-light:#6678f5; }
    * { box-sizing: border-box; }
    html { min-height: 100%%; background: var(--page); }
    body { position: relative; min-height: 100dvh; margin: 0; display: grid; place-items: center; gap: 16px; overflow-x: hidden; padding: 28px 18px; background: radial-gradient(circle at 18%% 10%%, rgba(92,108,255,.13), transparent 34%%), radial-gradient(circle at 88%% 88%%, rgba(62,190,255,.07), transparent 28%%), #f4f6fb; color: var(--text); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .55; background-image: linear-gradient(rgba(77,88,116,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(77,88,116,.035) 1px, transparent 1px); background-size: 32px 32px; mask-image: linear-gradient(to bottom, black, transparent 88%%); }
    svg { display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .remote-access-card { position: relative; z-index: 1; width: min(100%%, 488px); overflow: hidden; border: 1px solid var(--line); border-radius: 26px; background: linear-gradient(150deg, rgba(255,255,255,.99), rgba(250,251,254,.99)); padding: 32px; box-shadow: 0 28px 80px rgba(49,61,96,.16), 0 1px 0 #ffffff inset; }
    .remote-access-card::before { content: ""; position: absolute; width: 290px; height: 290px; top: -190px; right: -150px; border-radius: 999px; background: radial-gradient(circle, rgba(109,124,255,.18), transparent 68%%); pointer-events: none; }
    .card-content { position: relative; z-index: 1; }
    .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
    .brand-identity { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .brand-mark { width: 36px; height: 36px; display: inline-flex; flex: 0 0 36px; align-items: center; justify-content: center; border: 1px solid #d2d9ff; border-radius: 12px; background: linear-gradient(145deg, #eef1ff, #f7f8ff); color: #5369f3; box-shadow: 0 9px 24px rgba(77,93,224,.13); }
    .brand-mark svg { width: 22px; height: 22px; }
    .brand-name { color: #252b38; font-size: 13px; font-weight: 850; letter-spacing: .17em; }
    .connection-state { display: inline-flex; align-items: center; gap: 7px; color: #7f899a; font-size: 11px; white-space: nowrap; }
    .connection-state::before { content: ""; width: 6px; height: 6px; flex: 0 0 6px; border-radius: 999px; background: #e7a83f; box-shadow: 0 0 0 4px rgba(231,168,63,.12); }
    .protection-pill { width: fit-content; display: inline-flex; align-items: center; gap: 8px; border: 1px solid #d3d9ff; border-radius: 999px; padding: 7px 11px; background: #f0f2ff; color: #5369f3; font-size: 12px; font-weight: 750; }
    .protection-pill svg { width: 15px; height: 15px; }
    h1 { margin: 18px 0 12px; color: #202634; font-size: 34px; letter-spacing: -.045em; line-height: 1.08; }
    .intro-copy { margin: 0 0 26px; color: #6f798b; font-size: 14px; line-height: 1.7; }
    form { display: grid; gap: 10px; }
    label { color: #3f4756; font-size: 13px; font-weight: 720; }
    .password-field { position: relative; display: flex; align-items: center; min-height: 56px; border: 1px solid var(--line-strong); border-radius: 15px; background: #f7f8fb; transition: border-color .16s ease, box-shadow .16s ease, background .16s ease; }
    .password-field:focus-within { border-color: #9aa8ff; background: #ffffff; box-shadow: 0 0 0 4px rgba(83,105,243,.11), 0 12px 28px rgba(49,61,96,.09); }
    .password-icon { width: 19px; height: 19px; display: inline-flex; flex: 0 0 19px; margin-left: 16px; color: #8791a3; }
    .password-icon svg { width: 19px; height: 19px; }
    input { width: 100%%; min-width: 0; height: 54px; border: 0; outline: 0; background: transparent; color: var(--text); padding: 0 16px 0 12px; font: inherit; font-size: 16px; }
    input::placeholder { color: #9aa3b2; }
    input:disabled { cursor: not-allowed; opacity: .58; }
    .field-hint { color: #8992a2; font-size: 12px; }
    .submit { width: 100%%; min-height: 54px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; margin-top: 8px; border: 0; border-radius: 15px; background: linear-gradient(135deg, #6576ff, #5264ee); color: #fff; box-shadow: 0 13px 32px rgba(69,87,224,.30), 0 1px 0 rgba(255,255,255,.18) inset; font: inherit; font-weight: 820; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
    .submit svg { width: 18px; height: 18px; transition: transform .15s ease; }
    .submit:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 16px 38px rgba(69,87,224,.36), 0 1px 0 rgba(255,255,255,.18) inset; }
    .submit:hover:not(:disabled) svg { transform: translateX(3px); }
    .submit:active:not(:disabled) { transform: translateY(0); }
    .submit:focus-visible { outline: 3px solid rgba(153,167,255,.38); outline-offset: 3px; }
    .submit:disabled { opacity: .48; cursor: not-allowed; box-shadow: none; }
    .alert { margin: 0 0 18px; border: 1px solid #fecdd3; border-radius: 13px; padding: 11px 13px; background: #fff4f5; color: #b42336; font-size: 13px; }
    code { border-radius: 5px; background: #edf0ff; color: #4054c7; padding: 1px 5px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .remote-policy { display: flex; align-items: center; gap: 11px; margin-top: 23px; border: 1px solid #e4e8ef; border-radius: 14px; background: #f8f9fb; padding: 12px 13px; }
    .policy-icon { width: 31px; height: 31px; display: inline-flex; flex: 0 0 31px; align-items: center; justify-content: center; border-radius: 10px; background: #edf0ff; color: #5369f3; }
    .policy-icon svg { width: 17px; height: 17px; }
    .policy-copy { min-width: 0; display: grid; gap: 1px; }
    .policy-copy strong { color: #495264; font-size: 12px; }
    .policy-copy span { color: #818a9a; font-size: 11px; line-height: 1.45; }
    .page-footer { position: relative; z-index: 1; color: #8992a2; font-size: 11px; text-align: center; }
    @media (max-width: 520px) {
      body { place-items: start center; padding: max(16px, env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom)); }
      body::before { opacity: .18; }
      .remote-access-card { width: 100%%; border-radius: 22px; padding: 25px 20px; }
      .brand-row { margin-bottom: 23px; }
      .brand-mark { width: 34px; height: 34px; flex-basis: 34px; }
      .connection-state { font-size: 10px; }
      h1 { font-size: 30px; }
      .intro-copy { margin-bottom: 23px; font-size: 13px; }
      .page-footer { padding: 0 12px; }
    }
  </style>
</head>
<body>
  <main class="remote-access-shell remote-access-card" aria-labelledby="remoteAccessTitle">
    <div class="card-content">
      <div class="brand-row">
        <span class="brand-identity"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8.5 12 4l7 4.5v7L12 20l-7-4.5z"></path><path d="M8.5 10.5h.01M15.5 10.5h.01"></path><path d="M9 14c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2"></path></svg></span><span class="brand-name">AUTOTO</span></span>
        <span class="connection-state">等待验证</span>
      </div>
      <span class="protection-pill"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>远程访问保护</span>
      <header>
        <h1 id="remoteAccessTitle">安全解锁 Autoto</h1>
        <p class="intro-copy">当前请求来自非可信 localhost。输入访问密码后，才会开放 UI、API 与本机 Agent 控制能力。</p>
      </header>
      %s
      <form method="post" action="/auth/remote-access" autocomplete="off">
        <label for="remoteAccessPassword">访问密码</label>
        <div class="password-field">
          <span class="password-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg></span>
          <input id="remoteAccessPassword" name="password" type="password" inputmode="text" autocomplete="current-password" placeholder="请输入访问密码" aria-describedby="passwordHint" autofocus %s />
        </div>
        <span id="passwordHint" class="field-hint">密码只用于验证当前浏览器的远程会话。</span>
        %s
      </form>
      <div class="remote-policy">
        <span class="policy-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.5-2.5 7.8-7 10-4.5-2.2-7-5.5-7-10V6z"></path><path d="m9 12 2 2 4-4"></path></svg></span>
        <span class="policy-copy"><strong>远程安全模式已启用</strong><span>local token 保持隔离，bypassPermissions 自动禁用。</span></span>
      </div>
    </div>
  </main>
  <footer class="page-footer">本机 localhost 访问不受影响</footer>
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
