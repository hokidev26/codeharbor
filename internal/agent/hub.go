package agent

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

type Event struct {
	Type       string         `json:"type"`
	NarratorID string         `json:"narratorId,omitempty"`
	MessageID  string         `json:"messageId,omitempty"`
	Text       string         `json:"text,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
	CreatedAt  string         `json:"createdAt"`
}

type Subscriber chan Event

type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[Subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[Subscriber]struct{})}
}

func (h *Hub) Subscribe(ctx context.Context, narratorID string) Subscriber {
	ch := make(Subscriber, 32)
	h.mu.Lock()
	if h.subs[narratorID] == nil {
		h.subs[narratorID] = make(map[Subscriber]struct{})
	}
	h.subs[narratorID][ch] = struct{}{}
	h.mu.Unlock()
	go func() {
		<-ctx.Done()
		h.mu.Lock()
		delete(h.subs[narratorID], ch)
		if len(h.subs[narratorID]) == 0 {
			delete(h.subs, narratorID)
		}
		close(ch)
		h.mu.Unlock()
	}()
	return ch
}

func (h *Hub) Publish(event Event) {
	if event.CreatedAt == "" {
		event.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for sub := range h.subs[event.NarratorID] {
		select {
		case sub <- event:
		default:
		}
	}
}

func (e Event) JSON() []byte {
	data, _ := json.Marshal(e)
	return data
}
