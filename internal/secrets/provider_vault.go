package secrets

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/crypto/chacha20poly1305"
)

const (
	ProviderAPIKeyKind = "api_key"

	ProviderSecretSourceNone              = "none"
	ProviderSecretSourceEnvironment       = "environment"
	ProviderSecretSourceRuntime           = "runtime"
	ProviderSecretSourceOptional          = "optional"
	ProviderSecretSourceStored            = "stored"
	ProviderSecretSourceStoredUnavailable = "stored_unavailable"
)

var (
	ErrProviderSecretNotConfigured   = errors.New("provider secret is not configured")
	ErrProviderSecretKeyUnavailable  = errors.New("provider secret key material is unavailable")
	ErrProviderSecretBindingMismatch = errors.New("provider secret does not match the current provider configuration")
	ErrProviderSecretTampered        = errors.New("provider secret could not be authenticated")
)

const providerSecretKeyBytes = chacha20poly1305.KeySize

const (
	ProviderSecretPendingNone   = "none"
	ProviderSecretPendingSet    = "set"
	ProviderSecretPendingClear  = "clear"
	ProviderSecretPendingDelete = "delete"
)

// ProviderSecretRecord and ProviderSecretPending contain encrypted database
// material only. They live in this package so database implementations can
// satisfy ProviderVault without creating a db <-> secrets import cycle.
type ProviderSecretRecord struct {
	ProviderName              string
	SecretKind                string
	ActiveCiphertext          []byte
	ActiveNonce               []byte
	ActiveBindingFingerprint  []byte
	ActiveKeyVersion          int64
	ActiveLastFive            string
	ActiveSecretRevision      int64
	PendingAction             string
	PendingCiphertext         []byte
	PendingNonce              []byte
	PendingBindingFingerprint []byte
	PendingKeyVersion         int64
	PendingLastFive           string
	PendingSecretRevision     int64
	CreatedAt                 string
	UpdatedAt                 string
}

type ProviderSecretPending struct {
	ProviderName       string
	SecretKind         string
	Action             string
	Ciphertext         []byte
	Nonce              []byte
	BindingFingerprint []byte
	KeyVersion         int64
	LastFive           string
	SecretRevision     int64
}

// ProviderBinding contains only non-secret fields that determine where an API
// key may be sent. SecretRevision is persisted in config.json and coordinates
// crash-safe two-phase updates with the SQLite pending record.
type ProviderBinding struct {
	Name           string
	Type           string
	Profile        string
	BaseURL        string
	SecretRevision int64
}

// ProviderSecretMetadata is safe to expose through server response types. It
// intentionally contains no ciphertext or resolved secret material.
type ProviderSecretMetadata struct {
	Configured bool
	Persisted  bool
	LastFive   string
	Source     string
}

type providerSecretStore interface {
	GetProviderSecret(context.Context, string, string) (ProviderSecretRecord, error)
	ListProviderSecrets(context.Context) ([]ProviderSecretRecord, error)
	CountProviderSecrets(context.Context) (int, error)
	PutProviderSecretPending(context.Context, ProviderSecretPending) error
	CommitProviderSecretPending(context.Context, string, string) error
	RollbackProviderSecretPending(context.Context, string, string) error
	DeleteProviderSecret(context.Context, string, string) error
}

// ProviderVault encrypts Provider API keys before they cross the database
// boundary. The database and the local key file are deliberately separate so a
// copied database alone is insufficient to recover credentials.
type ProviderVault struct {
	store   providerSecretStore
	keyPath string
	mu      sync.Mutex
}

func NewProviderVault(store providerSecretStore, homeDir string) *ProviderVault {
	return &ProviderVault{
		store:   store,
		keyPath: filepath.Join(homeDir, "secrets", "provider-secrets.key"),
	}
}

func (v *ProviderVault) KeyPath() string {
	if v == nil {
		return ""
	}
	return v.keyPath
}

func ProviderBindingFingerprint(binding ProviderBinding) []byte {
	canonical := canonicalProviderBinding(binding)
	digest := sha256.Sum256([]byte(strings.Join([]string{
		"autoto-provider-binding-v1",
		canonical.Name,
		canonical.Type,
		canonical.Profile,
		canonical.BaseURL,
	}, "\x00")))
	return append([]byte(nil), digest[:]...)
}

func (v *ProviderVault) PrepareSet(ctx context.Context, binding ProviderBinding, plaintext string) (ProviderSecretMetadata, error) {
	if v == nil || v.store == nil {
		return ProviderSecretMetadata{}, ErrProviderSecretKeyUnavailable
	}
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" {
		return ProviderSecretMetadata{}, ErrProviderSecretNotConfigured
	}
	binding = canonicalProviderBinding(binding)
	if err := validateProviderBinding(binding); err != nil {
		return ProviderSecretMetadata{}, err
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	key, err := v.loadOrCreateKey(ctx)
	if err != nil {
		return ProviderSecretMetadata{}, err
	}
	ciphertext, nonce, err := encryptProviderSecret(key, binding, ProviderAPIKeyKind, []byte(plaintext))
	if err != nil {
		return ProviderSecretMetadata{}, err
	}
	lastFive := SecretLastFive(plaintext)
	if err := v.store.PutProviderSecretPending(ctx, ProviderSecretPending{
		ProviderName:       binding.Name,
		SecretKind:         ProviderAPIKeyKind,
		Action:             ProviderSecretPendingSet,
		Ciphertext:         ciphertext,
		Nonce:              nonce,
		BindingFingerprint: ProviderBindingFingerprint(binding),
		KeyVersion:         1,
		LastFive:           lastFive,
		SecretRevision:     binding.SecretRevision,
	}); err != nil {
		return ProviderSecretMetadata{}, fmt.Errorf("prepare provider secret update: %w", err)
	}
	return ProviderSecretMetadata{Configured: true, Persisted: true, LastFive: lastFive, Source: ProviderSecretSourceStored}, nil
}

func (v *ProviderVault) PrepareClear(ctx context.Context, binding ProviderBinding) error {
	if v == nil || v.store == nil {
		return ErrProviderSecretKeyUnavailable
	}
	binding = canonicalProviderBinding(binding)
	if err := validateProviderBinding(binding); err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if err := v.store.PutProviderSecretPending(ctx, ProviderSecretPending{
		ProviderName:       binding.Name,
		SecretKind:         ProviderAPIKeyKind,
		Action:             ProviderSecretPendingClear,
		BindingFingerprint: ProviderBindingFingerprint(binding),
		SecretRevision:     binding.SecretRevision,
	}); err != nil {
		return fmt.Errorf("prepare provider secret clear: %w", err)
	}
	return nil
}

func (v *ProviderVault) PrepareDelete(ctx context.Context, providerName string) error {
	if v == nil || v.store == nil {
		return ErrProviderSecretKeyUnavailable
	}
	providerName = strings.TrimSpace(providerName)
	if providerName == "" {
		return errors.New("provider name is required")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if err := v.store.PutProviderSecretPending(ctx, ProviderSecretPending{
		ProviderName: providerName,
		SecretKind:   ProviderAPIKeyKind,
		Action:       ProviderSecretPendingDelete,
	}); err != nil {
		return fmt.Errorf("prepare provider secret delete: %w", err)
	}
	return nil
}

func (v *ProviderVault) CommitPending(ctx context.Context, providerName string) error {
	if v == nil || v.store == nil {
		return ErrProviderSecretKeyUnavailable
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if err := v.store.CommitProviderSecretPending(ctx, strings.TrimSpace(providerName), ProviderAPIKeyKind); err != nil {
		return fmt.Errorf("commit provider secret update: %w", err)
	}
	return nil
}

func (v *ProviderVault) RollbackPending(ctx context.Context, providerName string) error {
	if v == nil || v.store == nil {
		return ErrProviderSecretKeyUnavailable
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if err := v.store.RollbackProviderSecretPending(ctx, strings.TrimSpace(providerName), ProviderAPIKeyKind); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("rollback provider secret update: %w", err)
	}
	return nil
}

func (v *ProviderVault) Delete(ctx context.Context, providerName string) error {
	if v == nil || v.store == nil {
		return ErrProviderSecretKeyUnavailable
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if err := v.store.DeleteProviderSecret(ctx, strings.TrimSpace(providerName), ProviderAPIKeyKind); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("delete provider secret: %w", err)
	}
	return nil
}

// Resolve returns an active secret only when its stored binding and revision
// exactly match the current Provider configuration. It never creates a missing
// master key while reading existing database material.
func (v *ProviderVault) Resolve(ctx context.Context, binding ProviderBinding) (string, ProviderSecretMetadata, error) {
	if v == nil || v.store == nil {
		return "", ProviderSecretMetadata{Source: ProviderSecretSourceNone}, ErrProviderSecretNotConfigured
	}
	binding = canonicalProviderBinding(binding)
	if err := validateProviderBinding(binding); err != nil {
		return "", ProviderSecretMetadata{Source: ProviderSecretSourceStoredUnavailable}, err
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	record, err := v.store.GetProviderSecret(ctx, binding.Name, ProviderAPIKeyKind)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ProviderSecretMetadata{Source: ProviderSecretSourceNone}, ErrProviderSecretNotConfigured
		}
		return "", ProviderSecretMetadata{Source: ProviderSecretSourceStoredUnavailable}, fmt.Errorf("load provider secret metadata: %w", err)
	}
	metadata := ProviderSecretMetadata{
		Configured: len(record.ActiveCiphertext) > 0,
		Persisted:  len(record.ActiveCiphertext) > 0,
		LastFive:   record.ActiveLastFive,
		Source:     ProviderSecretSourceStored,
	}
	if len(record.ActiveCiphertext) == 0 || len(record.ActiveNonce) == 0 {
		metadata.Configured = false
		metadata.Persisted = false
		metadata.LastFive = ""
		metadata.Source = ProviderSecretSourceNone
		return "", metadata, ErrProviderSecretNotConfigured
	}
	if !bytes.Equal(record.ActiveBindingFingerprint, ProviderBindingFingerprint(binding)) || record.ActiveSecretRevision != binding.SecretRevision {
		metadata.Configured = false
		metadata.Source = ProviderSecretSourceStoredUnavailable
		return "", metadata, ErrProviderSecretBindingMismatch
	}
	key, err := v.loadExistingKey()
	if err != nil {
		metadata.Configured = false
		metadata.Source = ProviderSecretSourceStoredUnavailable
		if errors.Is(err, os.ErrNotExist) {
			return "", metadata, ErrProviderSecretKeyUnavailable
		}
		return "", metadata, err
	}
	plaintext, err := decryptProviderSecret(key, binding, ProviderAPIKeyKind, record.ActiveNonce, record.ActiveCiphertext)
	if err != nil {
		metadata.Configured = false
		metadata.Source = ProviderSecretSourceStoredUnavailable
		return "", metadata, err
	}
	return string(plaintext), metadata, nil
}

func (v *ProviderVault) Metadata(ctx context.Context, binding ProviderBinding) ProviderSecretMetadata {
	secret, metadata, err := v.Resolve(ctx, binding)
	_ = secret
	if err == nil {
		return metadata
	}
	return metadata
}

// ReconcilePending resolves interrupted two-phase updates before any Provider is
// registered. Matching target config commits; old config rolls back; deleted
// Providers commit pending deletes and otherwise have orphan records removed.
func (v *ProviderVault) ReconcilePending(ctx context.Context, bindings map[string]ProviderBinding) error {
	if v == nil || v.store == nil {
		return nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	records, err := v.store.ListProviderSecrets(ctx)
	if err != nil {
		return fmt.Errorf("list provider secrets for recovery: %w", err)
	}
	var recoveryErrors []error
	for _, record := range records {
		binding, exists := bindings[record.ProviderName]
		binding = canonicalProviderBinding(binding)
		if record.PendingAction != "" && record.PendingAction != ProviderSecretPendingNone {
			targetMatches := exists &&
				bytes.Equal(record.PendingBindingFingerprint, ProviderBindingFingerprint(binding)) &&
				record.PendingSecretRevision == binding.SecretRevision
			commit := (record.PendingAction == ProviderSecretPendingDelete && !exists) ||
				((record.PendingAction == ProviderSecretPendingSet || record.PendingAction == ProviderSecretPendingClear) && targetMatches)
			if commit {
				if err := v.store.CommitProviderSecretPending(ctx, record.ProviderName, record.SecretKind); err != nil {
					recoveryErrors = append(recoveryErrors, fmt.Errorf("recover provider secret %s: %w", record.ProviderName, err))
					continue
				}
			} else if err := v.store.RollbackProviderSecretPending(ctx, record.ProviderName, record.SecretKind); err != nil && !errors.Is(err, sql.ErrNoRows) {
				recoveryErrors = append(recoveryErrors, fmt.Errorf("rollback provider secret %s: %w", record.ProviderName, err))
				continue
			}
		}
		if !exists {
			if err := v.store.DeleteProviderSecret(ctx, record.ProviderName, record.SecretKind); err != nil && !errors.Is(err, sql.ErrNoRows) {
				recoveryErrors = append(recoveryErrors, fmt.Errorf("clean orphan provider secret %s: %w", record.ProviderName, err))
			}
		}
	}
	return errors.Join(recoveryErrors...)
}

func (v *ProviderVault) loadOrCreateKey(ctx context.Context) ([]byte, error) {
	key, err := v.loadExistingKey()
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	count, countErr := v.store.CountProviderSecrets(ctx)
	if countErr != nil {
		return nil, fmt.Errorf("inspect provider secret store: %w", countErr)
	}
	if count > 0 {
		return nil, ErrProviderSecretKeyUnavailable
	}
	return v.createKey()
}

func (v *ProviderVault) loadExistingKey() ([]byte, error) {
	path := filepath.Clean(v.keyPath)
	if err := validateSecretDirectory(filepath.Dir(path), false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, os.ErrNotExist
		}
		return nil, ErrProviderSecretKeyUnavailable
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, ErrProviderSecretKeyUnavailable
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	defer file.Close()
	key := make([]byte, providerSecretKeyBytes)
	if _, err := io.ReadFull(file, key); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	var extra [1]byte
	if n, err := file.Read(extra[:]); err != io.EOF || n != 0 {
		return nil, ErrProviderSecretKeyUnavailable
	}
	return key, nil
}

func (v *ProviderVault) createKey() ([]byte, error) {
	dir := filepath.Dir(filepath.Clean(v.keyPath))
	if err := validateSecretDirectory(dir, true); err != nil {
		return nil, err
	}
	key := make([]byte, providerSecretKeyBytes)
	if _, err := rand.Read(key); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	file, err := os.OpenFile(v.keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return v.loadExistingKey()
		}
		return nil, ErrProviderSecretKeyUnavailable
	}
	completed := false
	defer func() {
		_ = file.Close()
		if !completed {
			_ = os.Remove(v.keyPath)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	if _, err := file.Write(key); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	if err := file.Sync(); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	if err := file.Close(); err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	directory, err := os.Open(dir)
	if err != nil {
		return nil, ErrProviderSecretKeyUnavailable
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return nil, ErrProviderSecretKeyUnavailable
	}
	_ = directory.Close()
	completed = true
	return key, nil
}

func validateSecretDirectory(dir string, create bool) error {
	info, err := os.Lstat(dir)
	if err != nil {
		if !create || !errors.Is(err, os.ErrNotExist) {
			if errors.Is(err, os.ErrNotExist) {
				return os.ErrNotExist
			}
			return ErrProviderSecretKeyUnavailable
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return ErrProviderSecretKeyUnavailable
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return ErrProviderSecretKeyUnavailable
		}
		info, err = os.Lstat(dir)
		if err != nil {
			return ErrProviderSecretKeyUnavailable
		}
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		return ErrProviderSecretKeyUnavailable
	}
	return nil
}

func encryptProviderSecret(key []byte, binding ProviderBinding, kind string, plaintext []byte) ([]byte, []byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, nil, ErrProviderSecretKeyUnavailable
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, ErrProviderSecretKeyUnavailable
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, providerSecretAAD(binding, kind))
	return ciphertext, nonce, nil
}

func decryptProviderSecret(key []byte, binding ProviderBinding, kind string, nonce, ciphertext []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil || len(nonce) != chacha20poly1305.NonceSizeX {
		return nil, ErrProviderSecretTampered
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, providerSecretAAD(binding, kind))
	if err != nil {
		return nil, ErrProviderSecretTampered
	}
	return plaintext, nil
}

func providerSecretAAD(binding ProviderBinding, kind string) []byte {
	binding = canonicalProviderBinding(binding)
	return []byte(fmt.Sprintf("autoto-provider-secret-v1\x00%s\x00%s\x00%d", hex.EncodeToString(ProviderBindingFingerprint(binding)), kind, binding.SecretRevision))
}

func canonicalProviderBinding(binding ProviderBinding) ProviderBinding {
	binding.Name = strings.TrimSpace(binding.Name)
	binding.Type = strings.ToLower(strings.TrimSpace(binding.Type))
	binding.Profile = strings.ToLower(strings.TrimSpace(binding.Profile))
	binding.BaseURL = canonicalProviderBaseURL(binding.BaseURL)
	return binding
}

func canonicalProviderBaseURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimRight(value, "/")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Fragment = ""
	if parsed.Path == "/" {
		parsed.Path = ""
	} else {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}
	return parsed.String()
}

func validateProviderBinding(binding ProviderBinding) error {
	if binding.Name == "" {
		return errors.New("provider name is required")
	}
	if binding.SecretRevision < 0 {
		return errors.New("provider secret revision is invalid")
	}
	return nil
}

func SecretLastFive(secret string) string {
	runes := []rune(secret)
	if len(runes) <= 5 {
		return ""
	}
	return string(runes[len(runes)-5:])
}
