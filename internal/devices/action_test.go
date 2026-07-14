package devices

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"
)

func TestActionCatalogValidationCanonicalizationAndRisk(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		action    Action
		wantRisk  RiskLevel
		wantInput string
	}{
		{name: "light on", action: Action{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"brightness":128,"entity_id":"light.kitchen"}`)}, wantRisk: RiskMedium, wantInput: `{"entity_id":"light.kitchen","brightness":128}`},
		{name: "light off", action: Action{Domain: "light", Service: "turn_off", Input: json.RawMessage(`{"entity_id":"light.kitchen"}`)}, wantRisk: RiskMedium, wantInput: `{"entity_id":"light.kitchen"}`},
		{name: "switch on", action: Action{Domain: "switch", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"switch.fan"}`)}, wantRisk: RiskMedium, wantInput: `{"entity_id":"switch.fan"}`},
		{name: "switch off", action: Action{Domain: "switch", Service: "turn_off", Input: json.RawMessage(`{"entity_id":"switch.fan"}`)}, wantRisk: RiskMedium, wantInput: `{"entity_id":"switch.fan"}`},
		{name: "climate temperature", action: Action{Domain: "climate", Service: "set_temperature", Input: json.RawMessage(`{"temperature":21.5,"entity_id":"climate.hall"}`)}, wantRisk: RiskHigh, wantInput: `{"entity_id":"climate.hall","temperature":21.5}`},
		{name: "cover open", action: Action{Domain: "cover", Service: "open_cover", Input: json.RawMessage(`{"entity_id":"cover.garage"}`)}, wantRisk: RiskHigh, wantInput: `{"entity_id":"cover.garage"}`},
		{name: "cover close", action: Action{Domain: "cover", Service: "close_cover", Input: json.RawMessage(`{"entity_id":"cover.garage"}`)}, wantRisk: RiskHigh, wantInput: `{"entity_id":"cover.garage"}`},
		{name: "lock", action: Action{Domain: "lock", Service: "lock", Input: json.RawMessage(`{"entity_id":"lock.front_door"}`)}, wantRisk: RiskHigh, wantInput: `{"entity_id":"lock.front_door"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if err := ValidateAction(test.action); err != nil {
				t.Fatalf("ValidateAction() error = %v", err)
			}
			if got := Risk(test.action); got != test.wantRisk {
				t.Fatalf("Risk() = %q, want %q", got, test.wantRisk)
			}
			canonical, err := CanonicalAction(test.action)
			if err != nil {
				t.Fatalf("CanonicalAction() error = %v", err)
			}
			if !IsCanonicalAction(canonical) {
				t.Fatal("canonical action was not sealed")
			}
			if string(canonical.Input) != test.wantInput {
				t.Fatalf("canonical input = %s, want %s", canonical.Input, test.wantInput)
			}
		})
	}

	catalog := ActionCatalog()
	if len(catalog) != len(tests) {
		t.Fatalf("catalog length = %d, want %d", len(catalog), len(tests))
	}
	catalog[0].Fields[0] = "mutated"
	if slices.Contains(ActionCatalog()[0].Fields, "mutated") {
		t.Fatal("ActionCatalog returned mutable internal data")
	}
}

func TestCriticalAndUnknownActionsAreHardBlocked(t *testing.T) {
	t.Parallel()

	blocked := []Action{
		{Domain: "lock", Service: "unlock", Input: json.RawMessage(`{"entity_id":"lock.front_door"}`)},
		{Domain: "alarm_control_panel", Service: "alarm_arm_away", Input: json.RawMessage(`{"entity_id":"alarm_control_panel.home"}`)},
		{Domain: "script", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"script.night"}`)},
		{Domain: "automation", Service: "trigger", Input: json.RawMessage(`{"entity_id":"automation.arrive"}`)},
		{Domain: "shell_command", Service: "backup", Input: json.RawMessage(`{"entity_id":"shell_command.backup"}`)},
		{Domain: "camera", Service: "snapshot", Input: json.RawMessage(`{"entity_id":"camera.entry"}`)},
		{Domain: "notify", Service: "notify", Input: json.RawMessage(`{"entity_id":"notify.mobile"}`)},
		{Domain: "light", Service: "toggle", Input: json.RawMessage(`{"entity_id":"light.kitchen"}`)},
	}

	for _, action := range blocked {
		if err := ValidateAction(action); !errors.Is(err, ErrActionBlocked) {
			t.Errorf("ValidateAction(%s.%s) error = %v, want blocked", action.Domain, action.Service, err)
		}
		if _, err := CanonicalAction(action); !errors.Is(err, ErrActionBlocked) {
			t.Errorf("CanonicalAction(%s.%s) error = %v, want blocked", action.Domain, action.Service, err)
		}
		if got := Risk(action); got != RiskBlocked {
			t.Errorf("Risk(%s.%s) = %q, want %q", action.Domain, action.Service, got, RiskBlocked)
		}
	}
}

func TestActionInputRejectsExtensionsTemplatesAndSecretKeys(t *testing.T) {
	t.Parallel()

	invalid := []Action{
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","payload":{"brightness":1}}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","domain":"lock"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","service":"toggle"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","template":"{{ secrets.token }}"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","accessToken":"secret"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.{{ target }}"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"switch.fan"}`)},
		{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"light.kitchen","brightness":256}`)},
		{Domain: "light", Service: "turn_off", Input: json.RawMessage(`{"entity_id":"light.kitchen","brightness":1}`)},
		{Domain: "climate", Service: "set_temperature", Input: json.RawMessage(`{"entity_id":"climate.hall"}`)},
		{Domain: "climate", Service: "set_temperature", Input: json.RawMessage(`{"entity_id":"climate.hall","temperature":501}`)},
		{Domain: "climate", Service: "set_temperature", Input: json.RawMessage(`{"entity_id":"climate.hall","temperature":20,"brightness":1}`)},
	}
	for _, action := range invalid {
		if err := ValidateAction(action); !errors.Is(err, ErrInvalidAction) {
			t.Errorf("ValidateAction(%s.%s, %s) error = %v, want invalid", action.Domain, action.Service, action.Input, err)
		}
		if got := Risk(action); got != RiskBlocked {
			t.Errorf("Risk(%s.%s, %s) = %q, want blocked", action.Domain, action.Service, action.Input, got)
		}
	}
}

func TestParseActionRejectsTopLevelExtensions(t *testing.T) {
	t.Parallel()

	valid, err := ParseAction(json.RawMessage(`{"domain":"switch","service":"turn_on","input":{"entity_id":"switch.fan"}}`))
	if err != nil {
		t.Fatalf("ParseAction(valid) error = %v", err)
	}
	if err := ValidateAction(valid); err != nil {
		t.Fatalf("ValidateAction(parsed) error = %v", err)
	}

	for _, raw := range []string{
		`{"domain":"switch","service":"turn_on","input":{"entity_id":"switch.fan"},"payload":{}}`,
		`{"domain":"switch","service":"turn_on","input":{"entity_id":"switch.fan"},"accessToken":"secret"}`,
		`{"domain":"switch","service":"turn_on","input":{"entity_id":"switch.fan"}} {}`,
	} {
		if _, err := ParseAction(json.RawMessage(raw)); !errors.Is(err, ErrInvalidAction) {
			t.Errorf("ParseAction(%s) error = %v, want invalid", raw, err)
		}
	}
}
