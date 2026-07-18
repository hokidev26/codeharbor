package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestFindOrCreateOAuthAppUserUsesIssuerSubjectAndBootstrapsFirstUser(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	project, _, _, err := store.CreateProject(ctx, "Unowned", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}

	provision := OAuthAppUserProvision{
		Issuer:       "https://issuer.example",
		Subject:      "subject-1",
		Handle:       "oidc-user",
		PasswordHash: "unusable-password-hash",
		Email:        "person@example.com",
		DisplayName:  "OIDC User",
	}
	user, created, err := store.FindOrCreateOAuthAppUser(ctx, provision, true)
	if err != nil {
		t.Fatal(err)
	}
	if !created || user.Handle != "oidc-user" {
		t.Fatalf("unexpected provisioned user: created=%v user=%+v", created, user)
	}
	member, err := store.IsProjectMember(ctx, user.ID, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !member {
		t.Fatal("first OIDC user did not receive unowned projects")
	}

	provision.Handle = "ignored-new-handle"
	provision.PasswordHash = ""
	provision.Email = "updated@example.com"
	provision.DisplayName = "Updated Name"
	reused, created, err := store.FindOrCreateOAuthAppUser(ctx, provision, false)
	if err != nil {
		t.Fatal(err)
	}
	if created || reused.ID != user.ID || reused.Handle != user.Handle {
		t.Fatalf("existing issuer+subject did not resolve the original user: created=%v user=%+v", created, reused)
	}
	identity, err := store.GetOAuthAppIdentity(ctx, provision.Issuer, provision.Subject)
	if err != nil {
		t.Fatal(err)
	}
	if identity.UserID != user.ID || identity.Email != "updated@example.com" || identity.DisplayName != "Updated Name" {
		t.Fatalf("identity metadata was not refreshed safely: %+v", identity)
	}

	second, created, err := store.FindOrCreateOAuthAppUser(ctx, OAuthAppUserProvision{
		Issuer:       provision.Issuer,
		Subject:      "subject-2",
		Handle:       "oidc-user-two",
		PasswordHash: "second-unusable-password-hash",
		Email:        identity.Email,
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if !created || second.ID == user.ID {
		t.Fatalf("mutable email incorrectly linked a different subject: created=%v first=%+v second=%+v", created, user, second)
	}
}

func TestFindOrCreateOAuthAppUserConcurrentClosedRegistrationCreatesOnlyFirstUser(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)

	const attempts = 24
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wait sync.WaitGroup
	wait.Add(attempts)
	for index := 0; index < attempts; index++ {
		index := index
		go func() {
			defer wait.Done()
			<-start
			_, _, err := store.FindOrCreateOAuthAppUser(ctx, OAuthAppUserProvision{
				Issuer:       "https://issuer.example",
				Subject:      fmt.Sprintf("subject-%d", index),
				Handle:       fmt.Sprintf("oidc-user-%d", index),
				PasswordHash: fmt.Sprintf("unusable-password-hash-%d", index),
				Email:        fmt.Sprintf("person-%d@example.com", index),
			}, false)
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	successes := 0
	denied := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, sql.ErrNoRows):
			denied++
		default:
			t.Fatalf("unexpected concurrent provisioning error: %v", err)
		}
	}
	if successes != 1 || denied != attempts-1 {
		t.Fatalf("closed registration created unexpected users: success=%d denied=%d", successes, denied)
	}
	var users, identities int
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM oauth_app_identities`).Scan(&identities); err != nil {
		t.Fatal(err)
	}
	if users != 1 || identities != 1 {
		t.Fatalf("concurrent first-user provisioning persisted users=%d identities=%d", users, identities)
	}
}

func TestFindOrCreateOAuthAppUserFailsClosedWithoutProvisioningAndOnHandleConflict(t *testing.T) {
	ctx := context.Background()
	store := newOAuthAppTestStore(t, ctx)
	if _, err := store.CreateUser(ctx, "existing-user", "existing-password-hash"); err != nil {
		t.Fatal(err)
	}

	request := OAuthAppUserProvision{Issuer: "https://issuer.example", Subject: "missing-subject"}
	if _, _, err := store.FindOrCreateOAuthAppUser(ctx, request, false); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing identity without provisioning returned %v", err)
	}
	if _, err := store.CreateUser(ctx, "taken-handle", "local-password-hash"); err != nil {
		t.Fatal(err)
	}
	request.Handle = "taken-handle"
	request.PasswordHash = "unusable-password-hash"
	if _, _, err := store.FindOrCreateOAuthAppUser(ctx, request, true); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting JIT handle returned %v", err)
	}
	if _, err := store.GetOAuthAppIdentity(ctx, request.Issuer, request.Subject); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("failed provisioning left an identity binding: %v", err)
	}
}
