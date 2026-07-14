package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"autoto/internal/db"
)

// Recorder persists a structured automation event. Implementations must return
// storage and validation errors so callers can fail closed when audit recording
// is required.
type Recorder interface {
	Record(context.Context, Event) error
}

// Event intentionally exposes only structured metadata. Raw tool input and
// secrets must never be placed in Details; the database store also rejects
// sensitive and raw-input key names recursively.
type Event struct {
	ID          string
	Category    string
	Action      string
	Actor       string
	AgentID     string
	RunID       string
	SubjectType string
	SubjectID   string
	Outcome     string
	Risk        string
	Details     map[string]any
	CreatedAt   string
}

type StoreRecorder struct {
	store *db.Store
}

func NewRecorder(store *db.Store) Recorder {
	return &StoreRecorder{store: store}
}

func NewStoreRecorder(store *db.Store) *StoreRecorder {
	return &StoreRecorder{store: store}
}

func (r *StoreRecorder) Record(ctx context.Context, event Event) error {
	if r == nil || r.store == nil {
		return errors.New("automation audit recorder requires a database store")
	}
	details := event.Details
	if details == nil {
		details = map[string]any{}
	}
	encoded, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("encode automation audit details: %w", err)
	}
	_, err = r.store.AddAutomationAuditEvent(ctx, db.AutomationAuditEvent{
		ID:          event.ID,
		Category:    event.Category,
		Action:      event.Action,
		Actor:       event.Actor,
		AgentID:     event.AgentID,
		RunID:       event.RunID,
		SubjectType: event.SubjectType,
		SubjectID:   event.SubjectID,
		Outcome:     event.Outcome,
		Risk:        event.Risk,
		DetailsJSON: encoded,
		CreatedAt:   event.CreatedAt,
	})
	if err != nil {
		return fmt.Errorf("record automation audit event: %w", err)
	}
	return nil
}
