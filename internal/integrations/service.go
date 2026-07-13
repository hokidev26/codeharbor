package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"autoto/internal/db"
	"autoto/internal/secrets"
)

// ConnectionStore is the persistence surface required by ConnectionService.
type ConnectionStore interface {
	GetIntegrationConnection(context.Context, string) (db.IntegrationConnection, error)
	ListIntegrationConnections(context.Context) ([]db.IntegrationConnection, error)
}

// ConnectionService combines persisted connection metadata with a secret
// resolver. Resolved values are available only on the internal result type.
type ConnectionService struct {
	store    ConnectionStore
	resolver secrets.Resolver
}

func NewConnectionService(store ConnectionStore, resolver secrets.Resolver) *ConnectionService {
	return &ConnectionService{store: store, resolver: resolver}
}

// ResolvedConnection is for trusted internal integration clients. Secrets is
// explicitly excluded from JSON serialization.
type ResolvedConnection struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Enabled      bool              `json:"enabled"`
	Endpoint     string            `json:"endpoint,omitempty"`
	SettingsJSON json.RawMessage   `json:"settings"`
	Secrets      map[string]string `json:"-"`
	CreatedAt    string            `json:"createdAt"`
	UpdatedAt    string            `json:"updatedAt"`
}

// PublicConnection is safe for API responses: it exposes only logical secret
// field names and whether a reference is configured, never a reference target
// or resolved value.
type PublicConnection struct {
	ID               string          `json:"id"`
	Kind             string          `json:"kind"`
	Name             string          `json:"name"`
	Enabled          bool            `json:"enabled"`
	Endpoint         string          `json:"endpoint,omitempty"`
	SettingsJSON     json.RawMessage `json:"settings"`
	SecretConfigured map[string]bool `json:"secretConfigured"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
}

// ConnectionView is an alias for the safe public representation.
type ConnectionView = PublicConnection

func (s *ConnectionService) Resolve(ctx context.Context, id string) (ResolvedConnection, error) {
	if s == nil || s.store == nil {
		return ResolvedConnection{}, errors.New("integration connection store is not configured")
	}
	if s.resolver == nil {
		return ResolvedConnection{}, errors.New("integration secret resolver is not configured")
	}
	connection, err := s.store.GetIntegrationConnection(ctx, id)
	if err != nil {
		return ResolvedConnection{}, err
	}
	resolved := ResolvedConnection{
		ID: connection.ID, Kind: connection.Kind, Name: connection.Name, Enabled: connection.Enabled,
		Endpoint: connection.Endpoint, SettingsJSON: cloneJSON(connection.SettingsJSON), Secrets: make(map[string]string, len(connection.SecretRefs)),
		CreatedAt: connection.CreatedAt, UpdatedAt: connection.UpdatedAt,
	}
	for logicalName, rawRef := range connection.SecretRefs {
		ref, err := secrets.ParseRef(rawRef)
		if err != nil {
			return ResolvedConnection{}, fmt.Errorf("invalid secret reference for %q", logicalName)
		}
		value, err := s.resolver.Resolve(ctx, ref)
		if err != nil {
			return ResolvedConnection{}, fmt.Errorf("resolve integration secret %q: %w", logicalName, err)
		}
		resolved.Secrets[logicalName] = value
	}
	return resolved, nil
}

// GetResolved is an explicit alias for Resolve.
func (s *ConnectionService) GetResolved(ctx context.Context, id string) (ResolvedConnection, error) {
	return s.Resolve(ctx, id)
}

// ResolveConnection is an explicit alias for Resolve.
func (s *ConnectionService) ResolveConnection(ctx context.Context, id string) (ResolvedConnection, error) {
	return s.Resolve(ctx, id)
}

func (s *ConnectionService) GetPublic(ctx context.Context, id string) (PublicConnection, error) {
	if s == nil || s.store == nil {
		return PublicConnection{}, errors.New("integration connection store is not configured")
	}
	connection, err := s.store.GetIntegrationConnection(ctx, id)
	if err != nil {
		return PublicConnection{}, err
	}
	return publicConnection(connection), nil
}

func (s *ConnectionService) GetPublicConnection(ctx context.Context, id string) (PublicConnection, error) {
	return s.GetPublic(ctx, id)
}

func (s *ConnectionService) ListPublic(ctx context.Context) ([]PublicConnection, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("integration connection store is not configured")
	}
	connections, err := s.store.ListIntegrationConnections(ctx)
	if err != nil {
		return nil, err
	}
	views := make([]PublicConnection, 0, len(connections))
	for _, connection := range connections {
		views = append(views, publicConnection(connection))
	}
	return views, nil
}

func (s *ConnectionService) ListPublicConnections(ctx context.Context) ([]PublicConnection, error) {
	return s.ListPublic(ctx)
}

func publicConnection(connection db.IntegrationConnection) PublicConnection {
	configured := make(map[string]bool, len(connection.SecretRefs))
	for logicalName := range connection.SecretRefs {
		configured[logicalName] = true
	}
	return PublicConnection{
		ID: connection.ID, Kind: connection.Kind, Name: connection.Name, Enabled: connection.Enabled,
		Endpoint: connection.Endpoint, SettingsJSON: cloneJSON(connection.SettingsJSON), SecretConfigured: configured,
		CreatedAt: connection.CreatedAt, UpdatedAt: connection.UpdatedAt,
	}
}

func cloneJSON(raw json.RawMessage) json.RawMessage {
	if raw == nil {
		return nil
	}
	return append(json.RawMessage(nil), raw...)
}
