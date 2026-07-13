package devices

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
)

const (
	// HomeAssistantKind is the only integration kind accepted by this adapter.
	HomeAssistantKind = "home-assistant"

	// MaxActionInputBytes bounds action data before it is decoded or sent.
	MaxActionInputBytes = 4 << 10
)

var (
	ErrInvalidConnection  = errors.New("invalid Home Assistant connection")
	ErrInvalidEndpoint    = errors.New("invalid Home Assistant endpoint")
	ErrMissingAccessToken = errors.New("Home Assistant access token is not configured")
	ErrInvalidAction      = errors.New("invalid Home Assistant action")
	ErrActionBlocked      = errors.New("Home Assistant action is blocked")
	ErrActionNotCanonical = errors.New("Home Assistant action is not canonical")
	ErrRequestFailed      = errors.New("Home Assistant request failed")
	ErrRemoteRejected     = errors.New("Home Assistant rejected the request")
	ErrInvalidResponse    = errors.New("invalid Home Assistant response")
	ErrResponseTooLarge   = errors.New("Home Assistant response exceeds the size limit")
)

// RiskLevel is the local confirmation level required for an action. Blocked
// actions must never be sent, regardless of confirmation.
type RiskLevel string

const (
	RiskMedium  RiskLevel = "medium"
	RiskHigh    RiskLevel = "high"
	RiskBlocked RiskLevel = "blocked"
)

// Entity is a public, deliberately small summary of a Home Assistant state.
// Attributes contains only adapter-approved scalar keys.
type Entity struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Domain     string         `json:"domain"`
	State      string         `json:"state"`
	Attributes map[string]any `json:"attributes"`
}

// Device is an adapter-neutral name for the same public summary. Home
// Assistant's /api/states endpoint exposes entities rather than device-registry
// records, so this adapter intentionally does not invent device relationships.
type Device = Entity

// Action keeps the fixed service selector separate from its service data.
// Input is validated with unknown-field rejection before it becomes canonical.
type Action struct {
	Domain  string          `json:"domain"`
	Service string          `json:"service"`
	Input   json.RawMessage `json:"input"`

	sealed bool
	seal   [32]byte
}

type actionWire struct {
	Domain  string          `json:"domain"`
	Service string          `json:"service"`
	Input   json.RawMessage `json:"input"`
}

// UnmarshalJSON rejects top-level payload extensions. Service-specific input is
// checked by CanonicalAction or ValidateAction.
func (a *Action) UnmarshalJSON(data []byte) error {
	if a == nil || len(data) > MaxActionInputBytes {
		return ErrInvalidAction
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var wire actionWire
	if err := decoder.Decode(&wire); err != nil {
		return ErrInvalidAction
	}
	if err := requireJSONEOF(decoder); err != nil {
		return ErrInvalidAction
	}
	*a = Action{Domain: wire.Domain, Service: wire.Service, Input: append(json.RawMessage(nil), wire.Input...)}
	return nil
}

// MarshalJSON never serializes the private canonical seal.
func (a Action) MarshalJSON() ([]byte, error) {
	return json.Marshal(actionWire{Domain: a.Domain, Service: a.Service, Input: a.Input})
}

// ActionDefinition describes the complete public action catalog.
type ActionDefinition struct {
	Domain  string    `json:"domain"`
	Service string    `json:"service"`
	Risk    RiskLevel `json:"risk"`
	Fields  []string  `json:"fields"`
}

// Adapter is the server-facing surface. A caller should canonicalize, inspect
// Risk, perform its local confirmations, and only then call Execute.
type Adapter interface {
	ListDevices(context.Context) ([]Device, error)
	ListEntities(context.Context) ([]Entity, error)
	ValidateAction(Action) error
	CanonicalAction(Action) (Action, error)
	Risk(Action) RiskLevel
	Execute(context.Context, Action) error
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ErrInvalidAction
	}
	return nil
}
