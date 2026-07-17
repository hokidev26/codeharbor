package gateway

import (
	"errors"
	"sync"
	"time"

	"autoto/internal/db"
)

var (
	errGatewayRateLimit   = errors.New("gateway request rate limit exceeded")
	errGatewayConcurrency = errors.New("gateway concurrency limit exceeded")
	errGatewayMonthly     = errors.New("gateway monthly token limit exceeded")
)

const defaultOutputReservation = int64(4096)

type keyLimitState struct {
	minuteStart    time.Time
	minuteCount    int64
	inFlight       int64
	reservedTokens int64
}

type requestLimiter struct {
	mu     sync.Mutex
	states map[string]*keyLimitState
	global chan struct{}
	now    func() time.Time
}

func newRequestLimiter(maxGlobalConcurrency int, now func() time.Time) *requestLimiter {
	if maxGlobalConcurrency <= 0 {
		maxGlobalConcurrency = 16
	}
	if now == nil {
		now = time.Now
	}
	return &requestLimiter{
		states: make(map[string]*keyLimitState),
		global: make(chan struct{}, maxGlobalConcurrency),
		now:    now,
	}
}

func (l *requestLimiter) allowRequest(key db.GatewayKey) error {
	limit := key.RequestsPerMinute
	if limit < 0 {
		return errGatewayRateLimit
	}
	if limit == 0 {
		return nil
	}
	minute := l.now().UTC().Truncate(time.Minute)

	l.mu.Lock()
	defer l.mu.Unlock()
	state := l.stateLocked(key.ID)
	if state.minuteStart.IsZero() || !state.minuteStart.Equal(minute) {
		state.minuteStart = minute
		state.minuteCount = 0
	}
	if state.minuteCount >= limit {
		return errGatewayRateLimit
	}
	state.minuteCount++
	return nil
}

// acquireIngress reserves global and per-key request capacity before the
// handler reads a chat-completion body. Its reservation is attached later,
// after the request has been parsed and validated.
func (l *requestLimiter) acquireIngress(key db.GatewayKey) (*ingressLease, error) {
	select {
	case l.global <- struct{}{}:
	default:
		return nil, errGatewayConcurrency
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if key.MaxConcurrency < 0 {
		<-l.global
		return nil, errGatewayConcurrency
	}
	state := l.stateLocked(key.ID)
	if key.MaxConcurrency > 0 && state.inFlight >= key.MaxConcurrency {
		<-l.global
		return nil, errGatewayConcurrency
	}
	state.inFlight++
	return &ingressLease{limiter: l, keyID: key.ID}, nil
}

func (l *requestLimiter) stateLocked(keyID string) *keyLimitState {
	state := l.states[keyID]
	if state == nil {
		state = &keyLimitState{}
		l.states[keyID] = state
	}
	return state
}

type ingressLease struct {
	limiter     *requestLimiter
	keyID       string
	reservation int64
	once        sync.Once
}

// Reserve attaches a parsed request's monthly-token allowance to an ingress
// lease. A failed reservation leaves the lease usable solely for Release.
func (l *ingressLease) Reserve(monthlyLimit, monthlyTokens, reservation int64) error {
	if l == nil || l.limiter == nil {
		return errGatewayConcurrency
	}
	if monthlyLimit < 0 || reservation < 0 {
		return errGatewayMonthly
	}
	if monthlyLimit == 0 || reservation == 0 {
		return nil
	}

	l.limiter.mu.Lock()
	defer l.limiter.mu.Unlock()
	state := l.limiter.states[l.keyID]
	if state == nil || monthlyTokens+state.reservedTokens+reservation > monthlyLimit {
		return errGatewayMonthly
	}
	state.reservedTokens += reservation
	l.reservation += reservation
	return nil
}

func (l *ingressLease) Release() {
	if l == nil || l.limiter == nil {
		return
	}
	l.once.Do(func() {
		l.limiter.mu.Lock()
		if state := l.limiter.states[l.keyID]; state != nil {
			if state.inFlight > 0 {
				state.inFlight--
			}
			state.reservedTokens -= l.reservation
			if state.reservedTokens < 0 {
				state.reservedTokens = 0
			}
		}
		l.limiter.mu.Unlock()
		<-l.limiter.global
	})
}
