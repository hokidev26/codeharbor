package oauthapp

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	DefaultLoginSessionTTL      = 10 * time.Minute
	DefaultLoginSessionCapacity = 1024
)

var (
	ErrLoginSessionInvalid  = errors.New("OIDC login session is invalid or already used")
	ErrLoginSessionExpired  = errors.New("OIDC login session has expired")
	ErrLoginSessionCapacity = errors.New("OIDC login session capacity reached")
	ErrInvalidRedirectAfter = errors.New("OIDC redirect-after path is invalid")

	errDuplicateLoginState = errors.New("duplicate OIDC login state")
)

type loginSessionStoreOptions struct {
	TTL      time.Duration
	Capacity int
	Now      func() time.Time
}

type loginSession struct {
	state              string
	nonce              string
	verifier           string
	browserBindingHash [sha256.Size]byte
	redirectAfter      string
	expiresAt          time.Time
}

// loginSessionStore stores only pending authorization attempts. Consume is
// atomic and deletes the session before returning it, so a callback can never
// exchange the same authorization code twice.
type loginSessionStore struct {
	mu       sync.Mutex
	sessions map[string]loginSession
	ttl      time.Duration
	capacity int
	now      func() time.Time
}

func newLoginSessionStore(options loginSessionStoreOptions) (*loginSessionStore, error) {
	ttl := options.TTL
	if ttl == 0 {
		ttl = DefaultLoginSessionTTL
	}
	capacity := options.Capacity
	if capacity == 0 {
		capacity = DefaultLoginSessionCapacity
	}
	if ttl < 0 || capacity < 0 {
		return nil, errors.New("OIDC login session store configuration is invalid")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &loginSessionStore{
		sessions: make(map[string]loginSession),
		ttl:      ttl,
		capacity: capacity,
		now:      now,
	}, nil
}

func (store *loginSessionStore) create(state, nonce, verifier, browserBinding, redirectAfter string) (loginSession, error) {
	if state == "" || nonce == "" || verifier == "" || browserBinding == "" {
		return loginSession{}, ErrLoginSessionInvalid
	}
	normalizedRedirect, err := NormalizeRedirectAfter(redirectAfter)
	if err != nil {
		return loginSession{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	now := store.now()
	store.pruneExpiredLocked(now)
	if _, exists := store.sessions[state]; exists {
		return loginSession{}, errDuplicateLoginState
	}
	if len(store.sessions) >= store.capacity {
		return loginSession{}, ErrLoginSessionCapacity
	}
	session := loginSession{
		state:              state,
		nonce:              nonce,
		verifier:           verifier,
		browserBindingHash: sha256.Sum256([]byte(browserBinding)),
		redirectAfter:      normalizedRedirect,
		expiresAt:          now.Add(store.ttl),
	}
	store.sessions[state] = session
	return session, nil
}

func (store *loginSessionStore) consume(state, browserBinding string) (loginSession, error) {
	if state == "" {
		return loginSession{}, ErrLoginSessionInvalid
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	session, exists := store.sessions[state]
	if !exists {
		return loginSession{}, ErrLoginSessionInvalid
	}
	providedBindingHash := sha256.Sum256([]byte(browserBinding))
	if subtle.ConstantTimeCompare(session.browserBindingHash[:], providedBindingHash[:]) != 1 {
		return loginSession{}, ErrLoginSessionInvalid
	}
	delete(store.sessions, state)
	if !session.expiresAt.After(store.now()) {
		return loginSession{}, ErrLoginSessionExpired
	}
	return session, nil
}

func (store *loginSessionStore) pending() int {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked(store.now())
	return len(store.sessions)
}

func (store *loginSessionStore) pruneExpiredLocked(now time.Time) {
	for state, session := range store.sessions {
		if !session.expiresAt.After(now) {
			delete(store.sessions, state)
		}
	}
}

// NormalizeRedirectAfter permits only same-origin application locations under
// /app. It rejects authority-relative URLs, path traversal, backslashes, and
// paths such as /application that merely share the same textual prefix.
func NormalizeRedirectAfter(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/app", nil
	}
	if strings.ContainsAny(raw, "\x00\r\n\\") {
		return "", ErrInvalidRedirectAfter
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.IsAbs() || parsed.Scheme != "" || parsed.Host != "" || parsed.User != nil || parsed.Opaque != "" {
		return "", ErrInvalidRedirectAfter
	}
	if parsed.Path != "/app" && !strings.HasPrefix(parsed.Path, "/app/") {
		return "", ErrInvalidRedirectAfter
	}
	if strings.Contains(parsed.Path, "//") || strings.ContainsRune(parsed.Path, '\\') {
		return "", ErrInvalidRedirectAfter
	}
	for _, segment := range strings.Split(parsed.Path, "/") {
		if segment == "." || segment == ".." {
			return "", ErrInvalidRedirectAfter
		}
	}
	for _, value := range []string{parsed.Path, parsed.RawQuery, parsed.Fragment} {
		for _, char := range value {
			if char < 0x20 || char == 0x7f {
				return "", ErrInvalidRedirectAfter
			}
		}
	}
	return parsed.String(), nil
}
