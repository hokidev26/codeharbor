package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"sync"
	"time"
)

const (
	ProtocolVersion          = 2
	DefaultRingSize          = 512
	DefaultReplayLimit       = 256
	DefaultSubscriberBuffer  = 64
	DefaultMaxStreams        = 256
	DefaultStreamIdleTimeout = 15 * time.Minute
)

type Event struct {
	Type          string         `json:"type"`
	AgentID       string         `json:"agentId,omitempty"`
	MessageID     string         `json:"messageId,omitempty"`
	Text          string         `json:"text,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
	CreatedAt     string         `json:"createdAt"`
	Protocol      int            `json:"protocol"`
	StreamSession string         `json:"streamSession"`
	Sequence      uint64         `json:"sequence"`
}

func (e Event) JSON() []byte {
	data, _ := json.Marshal(e)
	return data
}

// Subscriber is retained for protocol-1 callers. Protocol-2 callers should use
// SubscribeProtocol so that replay and resync state are observable.
type Subscriber chan Event

type ResyncReason string

const (
	ResyncSessionMismatch   ResyncReason = "session_mismatch"
	ResyncCursorExpired     ResyncReason = "cursor_expired"
	ResyncReplayLimit       ResyncReason = "replay_limit"
	ResyncSubscriberOverrun ResyncReason = "subscriber_overrun"
	ResyncStreamEvicted     ResyncReason = "stream_evicted"
)

type HubConfig struct {
	RingSize         int
	ReplayLimit      int
	SubscriberBuffer int
	MaxStreams       int
	IdleTimeout      time.Duration
	Clock            func() time.Time
	NewSession       func() string
}

type SubscribeOptions struct {
	AgentID       string
	StreamSession string
	After         uint64
	HasAfter      bool
}

// Subscription is a replay cut plus a live subscriber installed under the
// same Hub lock. Replay is complete or empty; callers must resync on Reason.
type Subscription struct {
	Events         <-chan Event
	Replay         []Event
	StreamSession  string
	OldestSequence uint64
	LatestSequence uint64
	Reason         ResyncReason
	Resync         <-chan ResyncReason

	events Subscriber
}

type hubSubscriber struct {
	events Subscriber
	resync chan ResyncReason
}

type stream struct {
	session      string
	sequence     uint64
	ring         []Event
	subscribers  map[*hubSubscriber]struct{}
	lastActivity time.Time
}

type Hub struct {
	mu      sync.Mutex
	config  HubConfig
	streams map[string]*stream
}

type StreamWatermark struct {
	StreamSession  string `json:"streamSession"`
	OldestSequence uint64 `json:"oldestSequence"`
	LatestSequence uint64 `json:"latestSequence"`
}

func (h *Hub) Watermark(agentID string) StreamWatermark {
	now := h.now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.collectGarbageLocked(now)
	current := h.ensureStreamLocked(agentID, now)
	if current == nil {
		return StreamWatermark{}
	}
	watermark := StreamWatermark{StreamSession: current.session, LatestSequence: current.sequence}
	if len(current.ring) > 0 {
		watermark.OldestSequence = current.ring[0].Sequence
	}
	return watermark
}

func NewHub() *Hub {
	return NewHubWithConfig(HubConfig{})
}

func NewHubWithConfig(config HubConfig) *Hub {
	if config.RingSize <= 0 {
		config.RingSize = DefaultRingSize
	}
	if config.ReplayLimit <= 0 {
		config.ReplayLimit = DefaultReplayLimit
	}
	if config.SubscriberBuffer <= 0 {
		config.SubscriberBuffer = DefaultSubscriberBuffer
	}
	if config.MaxStreams <= 0 {
		config.MaxStreams = DefaultMaxStreams
	}
	if config.IdleTimeout <= 0 {
		config.IdleTimeout = DefaultStreamIdleTimeout
	}
	if config.Clock == nil {
		config.Clock = time.Now
	}
	if config.NewSession == nil {
		config.NewSession = randomStreamSession
	}
	return &Hub{config: config, streams: make(map[string]*stream)}
}

func randomStreamSession() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic("generate stream session: " + err.Error())
	}
	return hex.EncodeToString(bytes[:])
}

// Subscribe retains the old realtime-only API. It intentionally does not
// replay events; websocket protocol 2 uses SubscribeProtocol instead.
func (h *Hub) Subscribe(ctx context.Context, agentID string) Subscriber {
	subscription := h.SubscribeProtocol(ctx, SubscribeOptions{AgentID: agentID})
	if subscription.Reason != "" {
		ch := make(Subscriber)
		close(ch)
		return ch
	}
	return subscription.events
}

// SubscribeProtocol atomically captures replay and installs the live
// subscription. A non-empty Reason means no events were replayed or subscribed.
func (h *Hub) SubscribeProtocol(ctx context.Context, options SubscribeOptions) *Subscription {
	now := h.now()
	h.mu.Lock()
	h.collectGarbageLocked(now)
	current := h.ensureStreamLocked(options.AgentID, now)
	if current == nil {
		h.mu.Unlock()
		return &Subscription{Reason: ResyncStreamEvicted}
	}

	result := &Subscription{
		StreamSession:  current.session,
		LatestSequence: current.sequence,
	}
	if len(current.ring) > 0 {
		result.OldestSequence = current.ring[0].Sequence
	}
	if options.StreamSession != "" && options.StreamSession != current.session {
		result.Reason = ResyncSessionMismatch
		h.mu.Unlock()
		return result
	}
	if options.HasAfter {
		if options.StreamSession == "" || options.After > current.sequence {
			result.Reason = ResyncSessionMismatch
			h.mu.Unlock()
			return result
		}
		if len(current.ring) > 0 {
			earliest := current.ring[0].Sequence
			if options.After < earliest-1 {
				result.Reason = ResyncCursorExpired
				h.mu.Unlock()
				return result
			}
		}
		replay := replayAfter(current.ring, options.After)
		if len(replay) > h.config.ReplayLimit {
			result.Reason = ResyncReplayLimit
			h.mu.Unlock()
			return result
		}
		result.Replay = replay
	}

	sub := &hubSubscriber{
		events: make(Subscriber, h.config.SubscriberBuffer),
		resync: make(chan ResyncReason, 1),
	}
	current.subscribers[sub] = struct{}{}
	current.lastActivity = now
	result.Events = sub.events
	result.Resync = sub.resync
	result.events = sub.events
	h.mu.Unlock()

	go func() {
		<-ctx.Done()
		h.removeSubscriber(options.AgentID, sub)
	}()
	return result
}

func replayAfter(events []Event, after uint64) []Event {
	first := 0
	for first < len(events) && events[first].Sequence <= after {
		first++
	}
	if first == len(events) {
		return nil
	}
	replay := make([]Event, len(events)-first)
	copy(replay, events[first:])
	return replay
}

// Publish assigns the protocol/session/sequence envelope before retaining and
// delivering the event. Slow subscribers are explicitly marked for resync.
func (h *Hub) Publish(event Event) {
	now := h.now()
	h.mu.Lock()
	h.collectGarbageLocked(now)
	current := h.ensureStreamLocked(event.AgentID, now)
	if current == nil {
		h.mu.Unlock()
		return
	}
	if current.sequence == math.MaxUint64 {
		h.resyncAllLocked(current, ResyncSessionMismatch)
		current.session = h.config.NewSession()
		current.sequence = 0
		current.ring = nil
	}
	current.sequence++
	event.Protocol = ProtocolVersion
	event.StreamSession = current.session
	event.Sequence = current.sequence
	if event.CreatedAt == "" {
		event.CreatedAt = now.UTC().Format(time.RFC3339Nano)
	}
	current.ring = append(current.ring, event)
	if overflow := len(current.ring) - h.config.RingSize; overflow > 0 {
		copy(current.ring, current.ring[overflow:])
		current.ring = current.ring[:len(current.ring)-overflow]
	}
	current.lastActivity = now
	for sub := range current.subscribers {
		select {
		case sub.events <- event:
		default:
			h.resyncSubscriberLocked(current, sub, ResyncSubscriberOverrun)
		}
	}
	h.mu.Unlock()
}

// CollectGarbage removes inactive streams immediately when the configured
// clock says that their idle timeout has elapsed. It is useful for tests and
// for applications that want deterministic reclamation without new traffic.
func (h *Hub) CollectGarbage() {
	h.mu.Lock()
	h.collectGarbageLocked(h.now())
	h.mu.Unlock()
}

func (h *Hub) removeSubscriber(agentID string, sub *hubSubscriber) {
	now := h.now()
	h.mu.Lock()
	current := h.streams[agentID]
	if current != nil {
		if _, ok := current.subscribers[sub]; ok {
			delete(current.subscribers, sub)
			close(sub.events)
			close(sub.resync)
			current.lastActivity = now
		}
	}
	h.mu.Unlock()
}

func (h *Hub) now() time.Time { return h.config.Clock().UTC() }

func (h *Hub) ensureStreamLocked(agentID string, now time.Time) *stream {
	if current := h.streams[agentID]; current != nil {
		return current
	}
	for len(h.streams) >= h.config.MaxStreams {
		victimID, victim := h.oldestStreamLocked()
		if victim == nil {
			return nil
		}
		h.resyncAllLocked(victim, ResyncStreamEvicted)
		delete(h.streams, victimID)
	}
	current := &stream{
		session:      h.config.NewSession(),
		subscribers:  make(map[*hubSubscriber]struct{}),
		lastActivity: now,
	}
	h.streams[agentID] = current
	return current
}

func (h *Hub) oldestStreamLocked() (string, *stream) {
	var victimID string
	var victim *stream
	for agentID, current := range h.streams {
		if victim == nil || current.lastActivity.Before(victim.lastActivity) {
			victimID, victim = agentID, current
		}
	}
	return victimID, victim
}

func (h *Hub) collectGarbageLocked(now time.Time) {
	for agentID, current := range h.streams {
		if len(current.subscribers) == 0 && !now.Before(current.lastActivity.Add(h.config.IdleTimeout)) {
			delete(h.streams, agentID)
		}
	}
}

func (h *Hub) resyncAllLocked(current *stream, reason ResyncReason) {
	for sub := range current.subscribers {
		h.resyncSubscriberLocked(current, sub, reason)
	}
}

func (h *Hub) resyncSubscriberLocked(current *stream, sub *hubSubscriber, reason ResyncReason) {
	delete(current.subscribers, sub)
	select {
	case sub.resync <- reason:
	default:
	}
	close(sub.events)
	close(sub.resync)
}
