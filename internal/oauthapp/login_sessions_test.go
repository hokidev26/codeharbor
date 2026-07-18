package oauthapp

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func newTestClock(now time.Time) *testClock {
	return &testClock{now: now}
}

func (clock *testClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *testClock) Advance(duration time.Duration) {
	clock.mu.Lock()
	clock.now = clock.now.Add(duration)
	clock.mu.Unlock()
}

func TestLoginSessionStoreSingleUseAndExpiry(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	store, err := newLoginSessionStore(loginSessionStoreOptions{
		TTL:      time.Minute,
		Capacity: 4,
		Now:      clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}

	created, err := store.create("state-one", "nonce-one", "verifier-one", "browser-one", "/app/settings")
	if err != nil {
		t.Fatal(err)
	}
	if want := clock.Now().Add(time.Minute); !created.expiresAt.Equal(want) {
		t.Fatalf("unexpected expiry: got %v want %v", created.expiresAt, want)
	}
	consumed, err := store.consume("state-one", "browser-one")
	if err != nil {
		t.Fatal(err)
	}
	if consumed.nonce != "nonce-one" || consumed.verifier != "verifier-one" || consumed.redirectAfter != "/app/settings" {
		t.Fatalf("unexpected consumed session: %+v", consumed)
	}
	if _, err := store.consume("state-one", "browser-one"); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("expected one-time session rejection, got %v", err)
	}

	if _, err := store.create("state-expired", "nonce", "verifier", "browser-expired", "/app"); err != nil {
		t.Fatal(err)
	}
	clock.Advance(time.Minute)
	if _, err := store.consume("state-expired", "browser-expired"); !errors.Is(err, ErrLoginSessionExpired) {
		t.Fatalf("expected expired session, got %v", err)
	}
	if _, err := store.consume("state-expired", "browser-expired"); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("expired session was not consumed: %v", err)
	}
}

func TestLoginSessionStoreBrowserBindingMismatchDoesNotConsumeSession(t *testing.T) {
	store, err := newLoginSessionStore(loginSessionStoreOptions{TTL: time.Minute, Capacity: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.create("bound-state", "nonce", "verifier", "browser-one", "/app"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.consume("bound-state", "browser-two"); !errors.Is(err, ErrLoginSessionInvalid) {
		t.Fatalf("expected cross-browser callback rejection, got %v", err)
	}
	if pending := store.pending(); pending != 1 {
		t.Fatalf("binding mismatch consumed the pending session: %d", pending)
	}
	if _, err := store.consume("bound-state", "browser-one"); err != nil {
		t.Fatalf("original browser could not consume its session: %v", err)
	}
}

func TestLoginSessionStoreCapacityPrunesExpiredSessions(t *testing.T) {
	clock := newTestClock(time.Unix(1_700_000_000, 0))
	store, err := newLoginSessionStore(loginSessionStoreOptions{
		TTL:      time.Minute,
		Capacity: 1,
		Now:      clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.create("state-one", "nonce", "verifier", "browser-one", "/app"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.create("state-two", "nonce", "verifier", "browser-two", "/app"); !errors.Is(err, ErrLoginSessionCapacity) {
		t.Fatalf("expected capacity error, got %v", err)
	}
	clock.Advance(time.Minute)
	if _, err := store.create("state-two", "nonce", "verifier", "browser-two", "/app"); err != nil {
		t.Fatalf("expired session did not release capacity: %v", err)
	}
	if pending := store.pending(); pending != 1 {
		t.Fatalf("unexpected pending session count: %d", pending)
	}
}

func TestLoginSessionStoreConcurrentConsumeHasOneWinner(t *testing.T) {
	store, err := newLoginSessionStore(loginSessionStoreOptions{TTL: time.Minute, Capacity: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.create("shared-state", "nonce", "verifier", "shared-browser", "/app"); err != nil {
		t.Fatal(err)
	}

	const callbacks = 32
	start := make(chan struct{})
	var successes atomic.Int32
	var invalid atomic.Int32
	var wait sync.WaitGroup
	wait.Add(callbacks)
	for index := 0; index < callbacks; index++ {
		go func() {
			defer wait.Done()
			<-start
			if _, err := store.consume("shared-state", "shared-browser"); err == nil {
				successes.Add(1)
			} else if errors.Is(err, ErrLoginSessionInvalid) {
				invalid.Add(1)
			}
		}()
	}
	close(start)
	wait.Wait()
	if successes.Load() != 1 || invalid.Load() != callbacks-1 {
		t.Fatalf("unexpected concurrent results: success=%d invalid=%d", successes.Load(), invalid.Load())
	}
}

func TestNormalizeRedirectAfter(t *testing.T) {
	for raw, want := range map[string]string{
		"":                                   "/app",
		"/app":                               "/app",
		"/app/":                              "/app/",
		"/app/settings?tab=security#profile": "/app/settings?tab=security#profile",
		" /app/projects/one ":                "/app/projects/one",
	} {
		t.Run("valid_"+raw, func(t *testing.T) {
			got, err := NormalizeRedirectAfter(raw)
			if err != nil {
				t.Fatalf("NormalizeRedirectAfter(%q): %v", raw, err)
			}
			if got != want {
				t.Fatalf("NormalizeRedirectAfter(%q)=%q want %q", raw, got, want)
			}
		})
	}

	invalid := []string{
		"https://evil.example/app",
		"//evil.example/app",
		"/",
		"/application",
		"/app/../admin",
		"/app/%2e%2e/admin",
		"/app//evil",
		"/app\\evil",
		"/app/%5c%5cevil",
		"/app\r\nLocation: https://evil.example",
	}
	for _, raw := range invalid {
		t.Run("invalid_"+raw, func(t *testing.T) {
			if _, err := NormalizeRedirectAfter(raw); !errors.Is(err, ErrInvalidRedirectAfter) {
				t.Fatalf("expected rejection for %q, got %v", raw, err)
			}
		})
	}
}
