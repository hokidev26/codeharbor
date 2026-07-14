package devices

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"math"
	"strings"
)

type actionInputKind uint8

const (
	inputEntityOnly actionInputKind = iota
	inputLightTurnOn
	inputClimateTemperature
)

type actionSpec struct {
	definition ActionDefinition
	inputKind  actionInputKind
}

var actionSpecs = []actionSpec{
	{definition: ActionDefinition{Domain: "light", Service: "turn_on", Risk: RiskMedium, Fields: []string{"entity_id", "brightness"}}, inputKind: inputLightTurnOn},
	{definition: ActionDefinition{Domain: "light", Service: "turn_off", Risk: RiskMedium, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
	{definition: ActionDefinition{Domain: "switch", Service: "turn_on", Risk: RiskMedium, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
	{definition: ActionDefinition{Domain: "switch", Service: "turn_off", Risk: RiskMedium, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
	{definition: ActionDefinition{Domain: "climate", Service: "set_temperature", Risk: RiskHigh, Fields: []string{"entity_id", "temperature"}}, inputKind: inputClimateTemperature},
	{definition: ActionDefinition{Domain: "cover", Service: "open_cover", Risk: RiskHigh, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
	{definition: ActionDefinition{Domain: "cover", Service: "close_cover", Risk: RiskHigh, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
	{definition: ActionDefinition{Domain: "lock", Service: "lock", Risk: RiskHigh, Fields: []string{"entity_id"}}, inputKind: inputEntityOnly},
}

// ActionCatalog returns a defensive copy of the fixed allowlist.
func ActionCatalog() []ActionDefinition {
	catalog := make([]ActionDefinition, 0, len(actionSpecs))
	for _, spec := range actionSpecs {
		definition := spec.definition
		definition.Fields = append([]string(nil), definition.Fields...)
		catalog = append(catalog, definition)
	}
	return catalog
}

// Catalog is a short alias for ActionCatalog.
func Catalog() []ActionDefinition {
	return ActionCatalog()
}

// ParseAction strictly decodes an action and rejects top-level extensions.
func ParseAction(raw json.RawMessage) (Action, error) {
	if len(raw) == 0 || len(raw) > MaxActionInputBytes {
		return Action{}, ErrInvalidAction
	}
	var action Action
	if err := json.Unmarshal(raw, &action); err != nil {
		return Action{}, ErrInvalidAction
	}
	return action, nil
}

// ValidateAction checks both the fixed domain/service catalog and the exact
// schema for that service's input.
func ValidateAction(action Action) error {
	_, err := CanonicalAction(action)
	return err
}

// CanonicalAction validates an action, rewrites its input to deterministic JSON,
// and attaches a private seal required by Execute.
func CanonicalAction(action Action) (Action, error) {
	spec, ok := lookupActionSpec(action.Domain, action.Service)
	if !ok {
		return Action{}, ErrActionBlocked
	}
	if len(action.Input) == 0 || len(action.Input) > MaxActionInputBytes {
		return Action{}, ErrInvalidAction
	}

	var canonicalInput []byte
	var err error
	switch spec.inputKind {
	case inputEntityOnly:
		canonicalInput, err = canonicalEntityOnlyInput(action.Input, action.Domain)
	case inputLightTurnOn:
		canonicalInput, err = canonicalLightTurnOnInput(action.Input, action.Domain)
	case inputClimateTemperature:
		canonicalInput, err = canonicalClimateTemperatureInput(action.Input, action.Domain)
	default:
		err = ErrActionBlocked
	}
	if err != nil {
		return Action{}, err
	}

	canonical := Action{
		Domain:  spec.definition.Domain,
		Service: spec.definition.Service,
		Input:   append(json.RawMessage(nil), canonicalInput...),
		sealed:  true,
	}
	canonical.seal = actionSeal(canonical)
	return canonical, nil
}

// Risk returns blocked for every action outside the allowlist or with invalid
// input, making omission of a separate validation call fail closed.
func Risk(action Action) RiskLevel {
	spec, ok := lookupActionSpec(action.Domain, action.Service)
	if !ok {
		return RiskBlocked
	}
	if _, err := CanonicalAction(action); err != nil {
		return RiskBlocked
	}
	return spec.definition.Risk
}

// IsCanonicalAction reports whether the action is unchanged since successful
// canonicalization.
func IsCanonicalAction(action Action) bool {
	return action.sealed && action.seal == actionSeal(action)
}

func lookupActionSpec(domain, service string) (actionSpec, bool) {
	for _, spec := range actionSpecs {
		if spec.definition.Domain == domain && spec.definition.Service == service {
			return spec, true
		}
	}
	return actionSpec{}, false
}

type entityOnlyInput struct {
	EntityID string `json:"entity_id"`
}

type lightTurnOnInput struct {
	EntityID   string `json:"entity_id"`
	Brightness *int   `json:"brightness,omitempty"`
}

type climateTemperatureInput struct {
	EntityID    string   `json:"entity_id"`
	Temperature *float64 `json:"temperature"`
}

func canonicalEntityOnlyInput(raw json.RawMessage, domain string) ([]byte, error) {
	var input entityOnlyInput
	if err := decodeActionInput(raw, &input); err != nil || !validEntityIDForDomain(input.EntityID, domain) {
		return nil, ErrInvalidAction
	}
	canonical, err := json.Marshal(input)
	if err != nil {
		return nil, ErrInvalidAction
	}
	return canonical, nil
}

func canonicalLightTurnOnInput(raw json.RawMessage, domain string) ([]byte, error) {
	var input lightTurnOnInput
	if err := decodeActionInput(raw, &input); err != nil || !validEntityIDForDomain(input.EntityID, domain) {
		return nil, ErrInvalidAction
	}
	if input.Brightness != nil && (*input.Brightness < 0 || *input.Brightness > 255) {
		return nil, ErrInvalidAction
	}
	canonical, err := json.Marshal(input)
	if err != nil {
		return nil, ErrInvalidAction
	}
	return canonical, nil
}

func canonicalClimateTemperatureInput(raw json.RawMessage, domain string) ([]byte, error) {
	var input climateTemperatureInput
	if err := decodeActionInput(raw, &input); err != nil || !validEntityIDForDomain(input.EntityID, domain) || input.Temperature == nil {
		return nil, ErrInvalidAction
	}
	if math.IsNaN(*input.Temperature) || math.IsInf(*input.Temperature, 0) || *input.Temperature < -100 || *input.Temperature > 500 {
		return nil, ErrInvalidAction
	}
	canonical, err := json.Marshal(input)
	if err != nil {
		return nil, ErrInvalidAction
	}
	return canonical, nil
}

func decodeActionInput(raw json.RawMessage, destination any) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) < 2 || trimmed[0] != '{' || trimmed[len(trimmed)-1] != '}' {
		return ErrInvalidAction
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return ErrInvalidAction
	}
	if err := requireJSONEOF(decoder); err != nil {
		return ErrInvalidAction
	}
	return nil
}

func splitEntityID(entityID string) (string, bool) {
	if entityID == "" || len(entityID) > 255 || entityID != strings.TrimSpace(entityID) {
		return "", false
	}
	parts := strings.Split(entityID, ".")
	if len(parts) != 2 || !validIdentifier(parts[0]) || !validIdentifier(parts[1]) {
		return "", false
	}
	return parts[0], true
}

func validEntityIDForDomain(entityID, domain string) bool {
	actualDomain, ok := splitEntityID(entityID)
	return ok && actualDomain == domain
}

func validIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_' {
			continue
		}
		return false
	}
	return true
}

func actionSeal(action Action) [32]byte {
	hash := sha256.New()
	_, _ = hash.Write([]byte(action.Domain))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(action.Service))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(action.Input)
	var seal [32]byte
	copy(seal[:], hash.Sum(nil))
	return seal
}
