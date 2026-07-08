package server

import (
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const localTokenHeader = "X-CodeHarbor-Token"
const localTokenCookieName = "codeharbor_local_token"
const localTokenQuery = "token"

func newLocalToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func (s *Server) localRequestGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	return constantTimeEqualToken(r.Header.Get(localTokenHeader), s.localToken)
}

func (s *Server) validWebSocketToken(r *http.Request) bool {
	if constantTimeEqualToken(r.URL.Query().Get(localTokenQuery), s.localToken) {
		return true
	}
	return constantTimeEqualToken(r.Header.Get(localTokenHeader), s.localToken)
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
	return sameHost(parsed.Host, r.Host)
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
