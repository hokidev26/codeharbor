package preview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"autoto/internal/process"
)

const (
	StateStopped  = "stopped"
	StateStarting = "starting"
	StateReady    = "ready"
	StateFailed   = "failed"
)

var (
	ErrStaleProfile  = errors.New("preview profile is stale")
	ErrInvalidPort   = errors.New("preview port is invalid")
	ErrManagerClosed = errors.New("preview manager is closed")
	ErrStartFailed   = errors.New("preview failed to start")
)

type StartOptions struct {
	ProfileID string
	Port      *int
}

type Status struct {
	Status    string `json:"status"`
	Running   bool   `json:"running"`
	ProfileID string `json:"profileId"`
	Port      int    `json:"port"`
	URL       string `json:"url"`
	Message   string `json:"message"`
}

type session struct {
	agentID string
	profile detectedProfile

	state    string
	running  bool
	port     int
	url      string
	message  string
	stopping bool

	logs   *logRing
	stdout *lineWriter
	stderr *lineWriter

	server *http.Server
	cmd    *exec.Cmd
	group  *process.Group
	done   chan struct{}
}

// Manager owns at most one preview per agent and is a runtime lifecycle service.
type Manager struct {
	opMu sync.Mutex
	mu   sync.RWMutex

	sessions map[string]*session
	closed   bool
	client   *http.Client
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*session),
		client: &http.Client{
			Timeout: 500 * time.Millisecond,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (m *Manager) Name() string { return "preview" }

func (m *Manager) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.RLock()
	closed := m.closed
	m.mu.RUnlock()
	if closed {
		return ErrManagerClosed
	}
	return nil
}

func (m *Manager) Close(ctx context.Context) error {
	m.opMu.Lock()
	defer m.opMu.Unlock()

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	sessions := make([]*session, 0, len(m.sessions))
	for _, current := range m.sessions {
		sessions = append(sessions, current)
	}
	m.mu.Unlock()

	var errs []error
	for _, current := range sessions {
		if err := m.stopSession(ctx, current, StateStopped, "preview manager closed"); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (m *Manager) Detect(root string) ([]Profile, error) {
	m.mu.RLock()
	closed := m.closed
	m.mu.RUnlock()
	if closed {
		return nil, ErrManagerClosed
	}
	return Detect(root)
}

func (m *Manager) StartPreview(ctx context.Context, agentID, root string, options StartOptions) (Status, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()

	m.mu.RLock()
	closed := m.closed
	m.mu.RUnlock()
	if closed {
		return stoppedStatus("preview manager is closed"), ErrManagerClosed
	}
	if strings.TrimSpace(agentID) == "" || strings.TrimSpace(options.ProfileID) == "" {
		return stoppedStatus("profileId is required"), ErrStaleProfile
	}
	if options.Port != nil && (*options.Port < 0 || *options.Port > 65535) {
		return stoppedStatus("port must be between 0 and 65535"), ErrInvalidPort
	}

	profiles, err := detectProfiles(root)
	if err != nil {
		return stoppedStatus("preview detection failed"), fmt.Errorf("%w: preview detection failed", ErrStartFailed)
	}
	var selected *detectedProfile
	for index := range profiles {
		if profiles[index].ID == options.ProfileID {
			selected = &profiles[index]
			break
		}
	}
	if selected == nil {
		return stoppedStatus("preview profile is stale; detect again"), ErrStaleProfile
	}

	m.mu.RLock()
	current := m.sessions[agentID]
	idempotent := current != nil && current.profile.ID == selected.ID && samePath(current.profile.workspace, selected.workspace) && (current.state == StateStarting || current.state == StateReady)
	active := current != nil && (current.running || current.server != nil || current.cmd != nil)
	m.mu.RUnlock()
	if idempotent {
		return m.statusFor(current), nil
	}
	if active {
		if err := m.stopSession(ctx, current, StateStopped, "preview replaced by another profile"); err != nil {
			return m.statusFor(current), fmt.Errorf("%w: previous preview did not stop", ErrStartFailed)
		}
	}

	current = newSession(agentID, *selected)
	m.mu.Lock()
	m.sessions[agentID] = current
	m.mu.Unlock()

	if selected.Kind == KindStatic {
		err = m.startStatic(ctx, current, options.Port)
	} else {
		err = m.startDynamic(ctx, current, options.Port)
	}
	return m.statusFor(current), err
}

func (m *Manager) StopPreview(ctx context.Context, agentID string) (Status, error) {
	m.opMu.Lock()
	defer m.opMu.Unlock()

	m.mu.RLock()
	current := m.sessions[agentID]
	m.mu.RUnlock()
	if current == nil {
		return stoppedStatus("preview is stopped"), nil
	}
	if err := m.stopSession(ctx, current, StateStopped, "preview is stopped"); err != nil {
		return m.statusFor(current), err
	}
	return m.statusFor(current), nil
}

func (m *Manager) Status(agentID string) Status {
	m.mu.RLock()
	current := m.sessions[agentID]
	m.mu.RUnlock()
	if current == nil {
		return stoppedStatus("preview is stopped")
	}
	return m.statusFor(current)
}

func (m *Manager) Logs(agentID string) Logs {
	m.mu.RLock()
	current := m.sessions[agentID]
	m.mu.RUnlock()
	if current == nil || current.logs == nil {
		return Logs{Lines: []LogLine{}}
	}
	return current.logs.snapshot()
}

func newSession(agentID string, profile detectedProfile) *session {
	ring := &logRing{}
	scrub := func(line string) string {
		line = strings.ReplaceAll(line, profile.workspace, ".")
		line = strings.ReplaceAll(line, strings.ReplaceAll(profile.workspace, "\\", "/"), ".")
		return line
	}
	return &session{
		agentID: agentID,
		profile: profile,
		state:   StateStarting,
		message: "preview is starting",
		logs:    ring,
		stdout:  &lineWriter{stream: "stdout", ring: ring, scrub: scrub},
		stderr:  &lineWriter{stream: "stderr", ring: ring, scrub: scrub},
		done:    make(chan struct{}),
	}
}

func (m *Manager) startStatic(ctx context.Context, current *session, requestedPort *int) error {
	listener, port, err := listenLoopback(requestedPort)
	if err != nil {
		m.failSession(current, "preview port is unavailable")
		return fmt.Errorf("%w: preview port is unavailable", ErrStartFailed)
	}
	server := &http.Server{
		Handler:           newStaticHandler(current.profile.workspace, current.profile.workdir),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	m.mu.Lock()
	current.server = server
	current.port = port
	current.url = "http://127.0.0.1:" + strconv.Itoa(port)
	current.running = true
	m.mu.Unlock()

	go func() {
		err := server.Serve(listener)
		m.finishSession(current, err, "preview server stopped unexpectedly")
		close(current.done)
	}()

	readyCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := m.waitHTTP(readyCtx, current); err != nil {
		_ = m.stopSession(context.Background(), current, StateFailed, "preview server did not become ready")
		return fmt.Errorf("%w: preview server did not become ready", ErrStartFailed)
	}
	m.markReady(current)
	return nil
}

func (m *Manager) startDynamic(ctx context.Context, current *session, requestedPort *int) error {
	if !dynamicSupported() {
		m.failSession(current, "dynamic previews are not supported on this platform")
		return fmt.Errorf("%w: dynamic previews are not supported on this platform", ErrStartFailed)
	}
	port, err := reserveLoopbackPort(requestedPort)
	if err != nil {
		m.failSession(current, "preview port is unavailable")
		return fmt.Errorf("%w: preview port is unavailable", ErrStartFailed)
	}
	argv := materializeArgv(current.profile.argv, port)
	if len(argv) == 0 {
		m.failSession(current, "preview profile is invalid")
		return fmt.Errorf("%w: preview profile is invalid", ErrStartFailed)
	}

	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = current.profile.workdir
	cmd.Env = append(os.Environ(), "BROWSER=none", "NO_OPEN=1")
	cmd.Stdout = current.stdout
	cmd.Stderr = current.stderr
	group := process.Prepare(cmd)
	if err := cmd.Start(); err != nil {
		_ = group.Close()
		m.failSession(current, "preview process could not be started")
		return fmt.Errorf("%w: preview process could not be started", ErrStartFailed)
	}
	if err := group.Started(cmd); err != nil {
		_ = cmd.Process.Kill()
		_ = group.Close()
		m.failSession(current, "preview process could not be started")
		return fmt.Errorf("%w: preview process group attach failed", ErrStartFailed)
	}

	m.mu.Lock()
	current.cmd = cmd
	current.group = group
	current.port = port
	current.url = "http://127.0.0.1:" + strconv.Itoa(port)
	current.running = true
	m.mu.Unlock()
	go func() {
		err := cmd.Wait()
		current.stdout.flush()
		current.stderr.flush()
		// Package managers can exit before descendants. Reap the process first,
		// then ensure its dedicated process group cannot keep serving.
		_ = group.Kill(cmd)
		_ = group.Close()
		m.finishSession(current, err, "preview process exited")
		close(current.done)
	}()

	readyCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := m.waitHTTP(readyCtx, current); err != nil {
		_ = m.stopSession(context.Background(), current, StateFailed, "preview process did not become ready")
		return fmt.Errorf("%w: preview process did not become ready", ErrStartFailed)
	}
	if err := validateLoopbackListener(readyCtx, port); err != nil {
		_ = m.stopSession(context.Background(), current, StateFailed, "preview process used an unsafe listener")
		return fmt.Errorf("%w: preview process used an unsafe listener", ErrStartFailed)
	}
	m.markReady(current)
	return nil
}

func (m *Manager) waitHTTP(ctx context.Context, current *session) error {
	m.mu.RLock()
	url := current.url
	m.mu.RUnlock()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err == nil {
			response, requestErr := m.client.Do(request)
			if requestErr == nil {
				_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
				_ = response.Body.Close()
				select {
				case <-current.done:
					return errors.New("preview stopped before ready")
				default:
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-current.done:
			return errors.New("preview stopped before ready")
		case <-ticker.C:
		}
	}
}

func (m *Manager) stopSession(ctx context.Context, current *session, finalState, message string) error {
	m.mu.Lock()
	if !current.running && current.server == nil && current.cmd == nil {
		current.state = finalState
		current.message = message
		current.url = ""
		current.port = 0
		m.mu.Unlock()
		return nil
	}
	current.stopping = true
	server := current.server
	cmd := current.cmd
	group := current.group
	done := current.done
	m.mu.Unlock()

	var stopErr error
	if server != nil {
		shutdownCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		stopErr = server.Shutdown(shutdownCtx)
		cancel()
		if stopErr != nil {
			_ = server.Close()
		}
	} else if cmd != nil && group != nil {
		// Signal the process group; the Wait goroutine owns the final Close.
		_ = group.Kill(cmd)
	}

	select {
	case <-done:
	case <-ctx.Done():
		if cmd != nil && group != nil {
			_ = group.Kill(cmd)
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		if stopErr == nil {
			stopErr = ctx.Err()
		}
	case <-time.After(2 * time.Second):
		if cmd != nil && group != nil {
			_ = group.Kill(cmd)
		} else if server != nil {
			_ = server.Close()
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			if stopErr == nil {
				stopErr = errors.New("preview did not stop")
			}
		}
	}
	if cmd != nil && group != nil {
		// The package-manager parent may exit before a child server. A final
		// group kill ensures no descendant survives after the parent is reaped.
		_ = group.Kill(cmd)
		_ = group.Close()
	}

	m.mu.Lock()
	if m.sessions[current.agentID] == current {
		current.state = finalState
		current.running = false
		current.port = 0
		current.url = ""
		current.message = message
		current.server = nil
		current.cmd = nil
		current.group = nil
		current.stopping = false
	}
	m.mu.Unlock()
	return stopErr
}

func (m *Manager) finishSession(current *session, serveErr error, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions[current.agentID] != current || current.stopping {
		return
	}
	current.state = StateFailed
	current.running = false
	current.port = 0
	current.url = ""
	current.server = nil
	// Keep cmd until StopPreview, replacement, or Close so the process group
	// can still be killed if a package-manager parent left descendants behind.
	current.message = message
	_ = serveErr
}

func (m *Manager) failSession(current *session, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions[current.agentID] != current {
		return
	}
	current.state = StateFailed
	current.running = false
	current.port = 0
	current.url = ""
	current.server = nil
	current.cmd = nil
	current.message = message
}

func (m *Manager) markReady(current *session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions[current.agentID] != current || current.stopping || !current.running {
		return
	}
	current.state = StateReady
	current.message = "preview is ready"
}

func (m *Manager) statusFor(current *session) Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return Status{
		Status:    current.state,
		Running:   current.running,
		ProfileID: current.profile.ID,
		Port:      current.port,
		URL:       current.url,
		Message:   current.message,
	}
}

func stoppedStatus(message string) Status {
	return Status{Status: StateStopped, Message: message}
}

func listenLoopback(requestedPort *int) (net.Listener, int, error) {
	port := 0
	if requestedPort != nil {
		port = *requestedPort
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return nil, 0, err
	}
	return listener, listener.Addr().(*net.TCPAddr).Port, nil
}

func reserveLoopbackPort(requestedPort *int) (int, error) {
	listener, port, err := listenLoopback(requestedPort)
	if err != nil {
		return 0, err
	}
	if err := listener.Close(); err != nil {
		return 0, err
	}
	return port, nil
}

func materializeArgv(argv []string, port int) []string {
	out := make([]string, len(argv))
	for index, arg := range argv {
		if arg == portPlaceholder {
			out[index] = strconv.Itoa(port)
		} else {
			out[index] = arg
		}
	}
	return out
}
