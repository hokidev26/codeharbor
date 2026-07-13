package channels

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"autoto/internal/db"
	"autoto/internal/runtime"
	"autoto/internal/tools"
)

// Manager discovers enabled Telegram integrations and owns one Service per
// resolved connection.
type Manager struct {
	store           Store
	connections     ConnectionResolver
	approvals       ApprovalService
	tools           *tools.Registry
	audit           AuditFunc
	apiBase         string
	httpClient      *http.Client
	refreshInterval time.Duration
	longPollTimeout time.Duration
	requestTimeout  time.Duration
	retryDelay      time.Duration
	rateLimit       int
	clock           func() time.Time
	onError         func(error)

	refreshMu sync.Mutex
	mu        sync.RWMutex
	started   bool
	closed    bool
	cancel    context.CancelFunc
	done      chan struct{}
	services  map[string]*Service
	failed    map[string]Status
}

var _ runtime.Service = (*Manager)(nil)

// NewManager constructs a Telegram channel manager.
func NewManager(config Config) (*Manager, error) {
	if config.Store == nil || config.Connections == nil {
		return nil, ErrInvalidConfig
	}
	if config.RefreshInterval <= 0 {
		config.RefreshInterval = DefaultRefreshInterval
	}
	if config.LongPollTimeout <= 0 {
		config.LongPollTimeout = DefaultLongPollTimeout
	}
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = DefaultRequestTimeout
	}
	if config.RetryDelay <= 0 {
		config.RetryDelay = DefaultRetryDelay
	}
	if config.RateLimit <= 0 {
		config.RateLimit = DefaultRateLimit
	}
	if config.Clock == nil {
		config.Clock = time.Now
	}
	return &Manager{
		store:           config.Store,
		connections:     config.Connections,
		approvals:       config.Approvals,
		tools:           config.Tools,
		audit:           config.Audit,
		apiBase:         config.APIBase,
		httpClient:      config.HTTPClient,
		refreshInterval: config.RefreshInterval,
		longPollTimeout: config.LongPollTimeout,
		requestTimeout:  config.RequestTimeout,
		retryDelay:      config.RetryDelay,
		rateLimit:       config.RateLimit,
		clock:           config.Clock,
		onError:         config.OnError,
		done:            make(chan struct{}),
		services:        make(map[string]*Service),
		failed:          make(map[string]Status),
	}, nil
}

// New is a convenience constructor for production wiring.
func New(store Store, connections ConnectionResolver, approvals ApprovalService, registry *tools.Registry, options ...Option) (*Manager, error) {
	config := Config{Store: store, Connections: connections, Approvals: approvals, Tools: registry}
	for _, option := range options {
		if option != nil {
			option(&config)
		}
	}
	return NewManager(config)
}

func (m *Manager) Start(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidConfig
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return ErrManagerClosed
	}
	if m.started {
		m.mu.Unlock()
		return ErrManagerStarted
	}
	managerCtx, cancel := context.WithCancel(ctx)
	m.started = true
	m.cancel = cancel
	m.mu.Unlock()

	if err := m.reconcile(managerCtx); err != nil {
		cancel()
		m.mu.Lock()
		m.started = false
		m.cancel = nil
		m.mu.Unlock()
		return err
	}
	go m.refreshLoop(managerCtx)
	return nil
}

func (m *Manager) Close(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidConfig
	}
	m.mu.Lock()
	if m.closed {
		done := m.done
		m.mu.Unlock()
		return waitForDone(ctx, done)
	}
	m.closed = true
	cancel := m.cancel
	started := m.started
	if !started {
		close(m.done)
	}
	done := m.done
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return waitForDone(ctx, done)
}

func (m *Manager) refreshLoop(ctx context.Context) {
	defer close(m.done)
	ticker := time.NewTicker(m.refreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			m.closeServices(context.Background())
			return
		case <-ticker.C:
			if err := m.reconcile(ctx); err != nil && ctx.Err() == nil {
				m.report("telegram connection refresh failed")
			}
		}
	}
}

func (m *Manager) reconcile(ctx context.Context) error {
	m.refreshMu.Lock()
	defer m.refreshMu.Unlock()
	connections, err := m.store.ListIntegrationConnections(ctx)
	if err != nil {
		return errors.New("channels: list integration connections failed")
	}
	desired := make(map[string]db.IntegrationConnection)
	for _, connection := range connections {
		if connection.Enabled && connection.Kind == TelegramKind {
			desired[connection.ID] = connection
		}
	}

	m.mu.RLock()
	existing := make(map[string]*Service, len(m.services))
	for id, service := range m.services {
		existing[id] = service
	}
	m.mu.RUnlock()

	for id, service := range existing {
		if _, ok := desired[id]; !ok {
			_ = service.Close(context.Background())
			m.mu.Lock()
			delete(m.services, id)
			delete(m.failed, id)
			m.mu.Unlock()
		}
	}

	for id, connection := range desired {
		resolved, resolveErr := m.connections.Resolve(ctx, id)
		if resolveErr != nil || resolved.Kind != TelegramKind || !resolved.Enabled {
			if current := existing[id]; current != nil {
				_ = current.Close(context.Background())
			}
			m.setFailed(connection, "telegram connection resolution failed")
			continue
		}
		candidate, createErr := NewService(ServiceConfig{
			Store: m.store, Approvals: m.approvals, Tools: m.tools, Audit: m.audit, Connection: resolved,
			APIBase: m.apiBase, HTTPClient: m.httpClient, LongPollTimeout: m.longPollTimeout,
			RequestTimeout: m.requestTimeout, RetryDelay: m.retryDelay, RateLimit: m.rateLimit,
			Clock: m.clock, OnError: m.onError,
		})
		if createErr != nil {
			if current := existing[id]; current != nil {
				_ = current.Close(context.Background())
			}
			m.setFailed(connection, "telegram connection configuration failed")
			continue
		}
		current := existing[id]
		if current != nil && current.updatedAt == candidate.updatedAt && current.credentialRevision == candidate.credentialRevision {
			m.mu.Lock()
			delete(m.failed, id)
			m.mu.Unlock()
			continue
		}
		if current != nil {
			_ = current.Close(context.Background())
		}
		if startErr := candidate.Start(ctx); startErr != nil {
			m.setFailed(connection, "telegram connection start failed")
			continue
		}
		m.mu.Lock()
		m.services[id] = candidate
		delete(m.failed, id)
		m.mu.Unlock()
	}
	return nil
}

func (m *Manager) closeServices(ctx context.Context) {
	m.refreshMu.Lock()
	defer m.refreshMu.Unlock()
	m.mu.Lock()
	services := make([]*Service, 0, len(m.services))
	for _, service := range m.services {
		services = append(services, service)
	}
	m.services = make(map[string]*Service)
	m.mu.Unlock()
	for _, service := range services {
		_ = service.Close(ctx)
	}
}

func (m *Manager) setFailed(connection db.IntegrationConnection, message string) {
	m.mu.Lock()
	if current := m.services[connection.ID]; current != nil {
		delete(m.services, connection.ID)
	}
	m.failed[connection.ID] = Status{ConnectionID: connection.ID, Name: connection.Name, Kind: TelegramKind, LastError: message}
	m.mu.Unlock()
	m.report(message)
}

// Status returns a secret-free status for one connection.
func (m *Manager) Status(connectionID string) (Status, bool) {
	connectionID = strings.TrimSpace(connectionID)
	m.mu.RLock()
	service := m.services[connectionID]
	failed, failedOK := m.failed[connectionID]
	m.mu.RUnlock()
	if service != nil {
		return service.Status(), true
	}
	return failed, failedOK
}

// ListStatuses returns statuses sorted by connection ID.
func (m *Manager) ListStatuses() []Status {
	m.mu.RLock()
	statuses := make([]Status, 0, len(m.services)+len(m.failed))
	for _, service := range m.services {
		statuses = append(statuses, service.Status())
	}
	for id, status := range m.failed {
		if _, active := m.services[id]; !active {
			statuses = append(statuses, status)
		}
	}
	m.mu.RUnlock()
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].ConnectionID < statuses[j].ConnectionID })
	return statuses
}

// Send is the notification-worker surface for Telegram outbound messages.
func (m *Manager) Send(ctx context.Context, connectionID, chatID, text string) error {
	m.mu.RLock()
	service := m.services[strings.TrimSpace(connectionID)]
	closed := m.closed
	m.mu.RUnlock()
	if closed {
		return ErrManagerClosed
	}
	if service == nil {
		return ErrConnectionNotActive
	}
	return service.Send(ctx, chatID, text)
}

func (m *Manager) report(message string) {
	if m.onError != nil {
		m.onError(errors.New("channels: " + message))
	}
}
