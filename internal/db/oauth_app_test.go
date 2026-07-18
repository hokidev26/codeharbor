package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const oauthAppTestSchema = `
CREATE TABLE IF NOT EXISTS oauth_app_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(issuer, subject)
);
CREATE TABLE IF NOT EXISTS oauth_app_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_app_sessions_user ON oauth_app_sessions(user_id);
`

func TestOAuthAppFreshTablesAndIdentityUpsert(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	firstUser := newOAuthAppTestUser(t, ctx, store)
	secondUser := newOAuthAppTestUser(t, ctx, store)

	identity, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
		Issuer: "https://issuer.example", Subject: "provider-user-1", UserID: firstUser.ID,
		Email: " first@example.com ", DisplayName: " First User ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if identity.UserID != firstUser.ID || identity.Email != "first@example.com" || identity.DisplayName != "First User" || identity.CreatedAt == "" || identity.UpdatedAt == "" {
		t.Fatalf("unexpected created identity: %+v", identity)
	}

	updated, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
		Issuer: identity.Issuer, Subject: identity.Subject, UserID: firstUser.ID,
		Email: "updated@example.com", DisplayName: "Updated",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.UserID != firstUser.ID || updated.Email != "updated@example.com" || updated.DisplayName != "Updated" || updated.CreatedAt != identity.CreatedAt || updated.UpdatedAt == identity.UpdatedAt {
		t.Fatalf("unexpected updated identity: before=%+v after=%+v", identity, updated)
	}

	_, err = store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
		Issuer: identity.Issuer, Subject: identity.Subject, UserID: secondUser.ID,
		Email: "attacker@example.com", DisplayName: "Attacker",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("identity rebind returned %v", err)
	}
	stored, err := store.GetOAuthAppIdentity(ctx, identity.Issuer, identity.Subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.UserID != firstUser.ID || stored.Email != updated.Email || stored.DisplayName != updated.DisplayName {
		t.Fatalf("failed rebind changed the stored identity: %+v", stored)
	}

	otherIssuer, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
		Issuer: "https://other-issuer.example", Subject: identity.Subject, UserID: secondUser.ID,
		Email: updated.Email,
	})
	if err != nil {
		t.Fatal(err)
	}
	otherSubject, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
		Issuer: identity.Issuer, Subject: "provider-user-2", UserID: secondUser.ID,
		Email: updated.Email,
	})
	if err != nil {
		t.Fatal(err)
	}
	if otherIssuer.UserID != secondUser.ID || otherSubject.UserID != secondUser.ID {
		t.Fatalf("issuer/subject identities were conflated: %+v %+v", otherIssuer, otherSubject)
	}
	if _, err := store.GetOAuthAppIdentity(ctx, identity.Issuer, "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing identity returned %v", err)
	}
	if _, err := store.GetOAuthAppIdentity(ctx, " "+identity.Issuer, identity.Subject); err == nil {
		t.Fatal("issuer identity key with surrounding whitespace was accepted")
	}
}

func TestOAuthAppIdentityConcurrentUpsertNeverSwitchesUser(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	firstUser := newOAuthAppTestUser(t, ctx, store)
	secondUser := newOAuthAppTestUser(t, ctx, store)

	const attempts = 24
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		userID := firstUser.ID
		if i%2 == 1 {
			userID = secondUser.ID
		}
		wg.Add(1)
		go func(index int, userID string) {
			defer wg.Done()
			<-start
			_, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{
				Issuer: "https://concurrent.example", Subject: "shared-subject", UserID: userID,
				Email: fmt.Sprintf("user-%d@example.com", index),
			})
			results <- err
		}(i, userID)
	}
	close(start)
	wg.Wait()
	close(results)

	successes, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent identity upsert error: %v", err)
		}
	}
	if successes == 0 || conflicts == 0 || successes+conflicts != attempts {
		t.Fatalf("unexpected concurrent upsert results: successes=%d conflicts=%d", successes, conflicts)
	}
	stored, err := store.GetOAuthAppIdentity(ctx, "https://concurrent.example", "shared-subject")
	if err != nil {
		t.Fatal(err)
	}
	if stored.UserID != firstUser.ID && stored.UserID != secondUser.ID {
		t.Fatalf("identity has an unexpected user binding: %+v", stored)
	}
}

func TestOAuthAppSessionLifecycleScopesAndNoPlaintextPersistence(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	user := newOAuthAppTestUser(t, ctx, store)
	now := time.Now().UTC()
	plaintext := "oauth-app-plaintext-token-that-must-never-be-stored"
	tokenHash := HashSessionToken(plaintext)

	session, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{
		TokenHash: tokenHash,
		UserID:    user.ID,
		Scopes:    []string{"write", " openid ", "read", "write"},
		ExpiresAt: now.Add(2 * time.Hour).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.ID == "" || session.CreatedAt == "" || session.LastSeenAt != session.CreatedAt || fmt.Sprint(session.Scopes) != "[openid read write]" || session.RevokedAt != "" {
		t.Fatalf("unexpected created OAuth app session: %+v", session)
	}
	encoded, err := json.Marshal(session)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), tokenHash) || strings.Contains(string(encoded), "tokenHash") {
		t.Fatalf("session JSON leaked its token hash: %s", encoded)
	}
	var scopesJSON string
	if err := store.DB().QueryRowContext(ctx, `SELECT scopes_json FROM oauth_app_sessions WHERE id = ?`, session.ID).Scan(&scopesJSON); err != nil {
		t.Fatal(err)
	}
	if scopesJSON != `["openid","read","write"]` {
		t.Fatalf("scopes were not stored canonically: %s", scopesJSON)
	}
	var plaintextRows int
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM oauth_app_sessions WHERE id = ? OR token_hash = ? OR user_id = ? OR scopes_json = ? OR expires_at = ? OR COALESCE(revoked_at,'') = ? OR created_at = ? OR last_seen_at = ?`, plaintext, plaintext, plaintext, plaintext, plaintext, plaintext, plaintext, plaintext).Scan(&plaintextRows); err != nil {
		t.Fatal(err)
	}
	if plaintextRows != 0 {
		t.Fatal("plaintext OAuth app token entered the database")
	}
	if _, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{TokenHash: plaintext, UserID: user.ID, ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)}); err == nil || strings.Contains(err.Error(), plaintext) {
		t.Fatalf("plaintext token was accepted or leaked in an error: %v", err)
	}

	valid, err := store.GetOAuthAppSessionByTokenHash(ctx, tokenHash)
	if err != nil || valid.ID != session.ID || fmt.Sprint(valid.Scopes) != "[openid read write]" {
		t.Fatalf("get valid session: session=%+v err=%v", valid, err)
	}
	newSeenAt := now.Add(30 * time.Minute).Truncate(time.Millisecond)
	touched, err := store.TouchOAuthAppSession(ctx, session.ID, newSeenAt.Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}
	if touched.LastSeenAt != newSeenAt.Format(time.RFC3339Nano) {
		t.Fatalf("touch did not advance last_seen_at: %+v", touched)
	}
	olderSeenAt := newSeenAt.Add(-time.Minute)
	touched, err = store.TouchOAuthAppSession(ctx, session.ID, olderSeenAt.Format(time.RFC3339Nano))
	if err != nil || touched.LastSeenAt != newSeenAt.Format(time.RFC3339Nano) {
		t.Fatalf("older touch moved last_seen_at backwards: %+v, %v", touched, err)
	}

	revoked, err := store.RevokeOAuthAppSession(ctx, session.ID)
	if err != nil || revoked.RevokedAt == "" {
		t.Fatalf("revoke session: %+v, %v", revoked, err)
	}
	revokedAgain, err := store.RevokeOAuthAppSession(ctx, session.ID)
	if err != nil || revokedAgain.RevokedAt != revoked.RevokedAt {
		t.Fatalf("session revoke was not idempotent: %+v, %v", revokedAgain, err)
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, tokenHash); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("revoked session remained valid: %v", err)
	}
	if _, err := store.TouchOAuthAppSession(ctx, session.ID, ""); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("revoked session could be touched: %v", err)
	}
	if _, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{TokenHash: strings.Repeat("a", 64), UserID: user.ID, Scopes: []string{"bad scope"}, ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)}); err == nil {
		t.Fatal("scope containing whitespace was accepted")
	}
}

func TestOAuthAppSessionExpirationFailClosedAndCleanup(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	user := newOAuthAppTestUser(t, ctx, store)
	now := time.Now().UTC()

	expired, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{
		TokenHash: strings.Repeat("1", 64), UserID: user.ID, Scopes: []string{"read"},
		ExpiresAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, expired.TokenHash); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expired session did not fail closed: %v", err)
	}

	createdAt := now.Format(time.RFC3339Nano)
	if _, err := store.DB().ExecContext(ctx, `INSERT INTO oauth_app_sessions (id, token_hash, user_id, scopes_json, expires_at, revoked_at, created_at, last_seen_at) VALUES
('malformed-expiry', ?, ?, '["read"]', 'not-a-time', NULL, ?, ?),
('pre-revoked', ?, ?, '["read"]', ?, '', ?, ?)`,
		strings.Repeat("2", 64), user.ID, createdAt, createdAt,
		strings.Repeat("3", 64), user.ID, now.Add(time.Hour).Format(time.RFC3339Nano), createdAt, createdAt); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, strings.Repeat("2", 64)); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("malformed expiration did not fail closed: %v", err)
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, strings.Repeat("3", 64)); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("non-null revoked_at did not fail closed: %v", err)
	}

	removed, err := store.CleanupExpiredOAuthAppSessions(ctx, now.Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Fatalf("cleanup removed %d sessions, want expired plus malformed", removed)
	}
	var remaining int
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM oauth_app_sessions WHERE id = 'pre-revoked'`).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("cleanup removed an unexpired revoked session: count=%d err=%v", remaining, err)
	}
}

func TestOAuthAppSessionRevokeAllAndConcurrentRead(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	user := newOAuthAppTestUser(t, ctx, store)
	otherUser := newOAuthAppTestUser(t, ctx, store)
	expiresAt := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)

	var userSessions []OAuthAppSession
	for index, hashChar := range []string{"4", "5", "6"} {
		session, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{ID: fmt.Sprintf("user-session-%d", index), TokenHash: strings.Repeat(hashChar, 64), UserID: user.ID, Scopes: []string{"read"}, ExpiresAt: expiresAt})
		if err != nil {
			t.Fatal(err)
		}
		userSessions = append(userSessions, session)
	}
	otherSession, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{TokenHash: strings.Repeat("7", 64), UserID: otherUser.ID, Scopes: []string{"read"}, ExpiresAt: expiresAt})
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	errs := make(chan error, 40)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := store.GetOAuthAppSessionByTokenHash(ctx, userSessions[0].TokenHash)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				errs <- err
			}
		}()
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if _, err := store.RevokeOAuthAppSession(ctx, userSessions[0].ID); err != nil {
				errs <- err
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent revoke/read failed: %v", err)
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, userSessions[0].TokenHash); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("session was valid after concurrent revoke completed: %v", err)
	}

	revokedCount, err := store.RevokeOAuthAppSessionsForUser(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if revokedCount != 2 {
		t.Fatalf("revoke all newly revoked %d sessions, want 2", revokedCount)
	}
	for _, session := range userSessions {
		if _, err := store.GetOAuthAppSessionByTokenHash(ctx, session.TokenHash); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("user session %s remained valid: %v", session.ID, err)
		}
	}
	if _, err := store.GetOAuthAppSessionByTokenHash(ctx, otherSession.TokenHash); err != nil {
		t.Fatalf("other user's session was revoked: %v", err)
	}
	if count, err := store.RevokeOAuthAppSessionsForUser(ctx, user.ID); err != nil || count != 0 {
		t.Fatalf("second revoke all was not idempotent: count=%d err=%v", count, err)
	}
}

func newOAuthAppTestStore(t *testing.T, ctx context.Context) *Store {
	t.Helper()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "oauth-app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close OAuth app test store: %v", err)
		}
	})
	if _, err := store.DB().ExecContext(ctx, oauthAppTestSchema); err != nil {
		t.Fatalf("create fresh OAuth app tables: %v", err)
	}
	return store
}

func newOAuthAppTestUser(t *testing.T, ctx context.Context, store *Store) User {
	t.Helper()
	user, err := store.CreateUser(ctx, "oauth-"+NewID(), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	return user
}
