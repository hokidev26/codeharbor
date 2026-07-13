package channels

import (
	"context"
	"errors"
	"net/http"
	"time"

	"autoto/internal/db"
	"autoto/internal/integrations"
	"autoto/internal/tools"
)

const (
	TelegramKind           = "telegram"
	DefaultTelegramAPIBase = "https://api.telegram.org"

	DefaultRefreshInterval = 5 * time.Second
	DefaultLongPollTimeout = 25 * time.Second
	DefaultRequestTimeout  = 35 * time.Second
	DefaultRetryDelay      = 500 * time.Millisecond
	DefaultRateLimit       = 10

	MaxTelegramResponseBytes = 1 << 20
	MaxTelegramMessageBytes  = 8 << 10
	MaxTelegramSendBytes     = 4 << 10
)

var (
	ErrInvalidConfig       = errors.New("channels: invalid configuration")
	ErrManagerStarted      = errors.New("channels: manager already started")
	ErrManagerClosed       = errors.New("channels: manager is closed")
	ErrServiceStarted      = errors.New("channels: service already started")
	ErrServiceClosed       = errors.New("channels: service is closed")
	ErrConnectionNotActive = errors.New("channels: telegram connection is not active")
	ErrTelegramRequest     = errors.New("channels: telegram request failed")
	ErrTelegramResponse    = errors.New("channels: invalid telegram response")
	ErrTelegramRejected    = errors.New("channels: telegram request rejected")
	ErrTelegramTooLarge    = errors.New("channels: telegram response is too large")
	ErrAuditRequired       = errors.New("channels: required audit record failed")
)

// Store is the persistence surface required by the Telegram control plane.
// *db.Store implements this interface.
type Store interface {
	ListIntegrationConnections(context.Context) ([]db.IntegrationConnection, error)

	GetChannelCursor(context.Context, string) (db.ChannelCursor, error)
	RecordChannelEventAndAdvanceCursor(context.Context, db.ChannelEvent, int64, int64) (db.ChannelEvent, bool, db.ChannelCursor, error)
	MarkChannelEventProcessed(context.Context, string, string) (db.ChannelEvent, error)

	ListChannelPairings(context.Context, ...any) ([]db.ChannelPairing, error)
	ActivateChannelPairing(context.Context, string, string, string, string, int64) (db.ChannelPairing, error)
	RecordChannelPairingFailure(context.Context, string, int, string) (db.ChannelPairing, error)
	RevokeChannelPairing(context.Context, string) (db.ChannelPairing, error)

	GetAgent(context.Context, string) (db.Agent, error)
	ListRuns(context.Context, string, int) ([]db.Run, error)
	ListPendingToolCalls(context.Context, string) ([]db.ToolCall, error)
	GetToolCallByUseID(context.Context, string, string) (db.ToolCall, error)

	AddAutomationAuditEvent(context.Context, db.AutomationAuditEvent) (db.AutomationAuditEvent, error)
}

// ConnectionResolver resolves secret references for trusted internal callers.
type ConnectionResolver interface {
	Resolve(context.Context, string) (integrations.ResolvedConnection, error)
}

// ApprovalDecision carries the fixed channel decision and the generations
// persisted with the pending tool call.
type ApprovalDecision struct {
	Decision             string
	Reason               string
	DecidedBy            string
	PermissionGeneration int64
	PolicyGeneration     int64
}

// ApprovalService is the narrow agent-approval boundary used by channels.
type ApprovalService interface {
	ApproveToolCall(context.Context, string, string, ApprovalDecision) (bool, error)
}

// AuditFunc can be injected by tests. Nil uses Store.AddAutomationAuditEvent.
type AuditFunc func(context.Context, db.AutomationAuditEvent) error

// Config configures a Manager. APIBase and HTTPClient are injection points for
// tests; production callers should leave APIBase empty so the only default is
// https://api.telegram.org.
type Config struct {
	Store       Store
	Connections ConnectionResolver
	Approvals   ApprovalService
	Tools       *tools.Registry
	Audit       AuditFunc

	APIBase    string
	HTTPClient *http.Client

	RefreshInterval time.Duration
	LongPollTimeout time.Duration
	RequestTimeout  time.Duration
	RetryDelay      time.Duration
	RateLimit       int
	Clock           func() time.Time
	OnError         func(error)
}

// ServiceConfig configures one Telegram integration connection.
type ServiceConfig struct {
	Store      Store
	Approvals  ApprovalService
	Tools      *tools.Registry
	Audit      AuditFunc
	Connection integrations.ResolvedConnection

	APIBase    string
	HTTPClient *http.Client

	LongPollTimeout time.Duration
	RequestTimeout  time.Duration
	RetryDelay      time.Duration
	RateLimit       int
	Clock           func() time.Time
	OnError         func(error)
}

// Option configures the convenience New constructor.
type Option func(*Config)

func WithAPIBase(base string) Option {
	return func(config *Config) { config.APIBase = base }
}

func WithHTTPClient(client *http.Client) Option {
	return func(config *Config) { config.HTTPClient = client }
}

func WithRefreshInterval(interval time.Duration) Option {
	return func(config *Config) { config.RefreshInterval = interval }
}

func WithLongPollTimeout(timeout time.Duration) Option {
	return func(config *Config) { config.LongPollTimeout = timeout }
}

func WithRequestTimeout(timeout time.Duration) Option {
	return func(config *Config) { config.RequestTimeout = timeout }
}

func WithRetryDelay(delay time.Duration) Option {
	return func(config *Config) { config.RetryDelay = delay }
}

func WithRateLimit(limit int) Option {
	return func(config *Config) { config.RateLimit = limit }
}

func WithClock(clock func() time.Time) Option {
	return func(config *Config) { config.Clock = clock }
}

func WithAudit(audit AuditFunc) Option {
	return func(config *Config) { config.Audit = audit }
}

func WithErrorHandler(handler func(error)) Option {
	return func(config *Config) { config.OnError = handler }
}

// Status is deliberately secret-free and safe to expose to internal status APIs.
type Status struct {
	ConnectionID string `json:"connectionId"`
	Name         string `json:"name,omitempty"`
	Kind         string `json:"kind"`
	Running      bool   `json:"running"`
	Cursor       int64  `json:"cursor"`
	StartedAt    string `json:"startedAt,omitempty"`
	LastPollAt   string `json:"lastPollAt,omitempty"`
	LastError    string `json:"lastError,omitempty"`
}
