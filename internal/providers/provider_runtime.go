package providers

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"autoto/internal/config"
)

var (
	ErrProviderUnavailable        = errors.New("provider unavailable")
	ErrReasoningEffortUnsupported = errors.New("reasoning effort is not supported")
	ErrFastModeUnsupported        = errors.New("fast mode is not supported")
)

var clientVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$`)

func providerUnavailableError(providerName, detail string) error {
	providerName = strings.TrimSpace(providerName)
	if providerName == "" {
		providerName = "model"
	}
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return fmt.Errorf("%w: %s provider is unavailable", ErrProviderUnavailable, providerName)
	}
	return fmt.Errorf("%w: %s provider is unavailable: %s", ErrProviderUnavailable, providerName, detail)
}

var legacyReasoningEfforts = []string{"low", "medium", "high"}

var canonicalReasoningEfforts = []string{"low", "medium", "high", "xhigh"}

// canonicalCapabilities preserves the legacy boolean capability while exposing
// a canonical values list to model-catalog clients. A legacy true boolean means
// the historical low/medium/high set, never xhigh.
func canonicalCapabilities(capabilities Capabilities) Capabilities {
	values := canonicalReasoningEffortValues(capabilities.ReasoningEfforts)
	if capabilities.Reasoning {
		capabilities.ReasoningEffort = true
	}
	if len(values) == 0 && capabilities.ReasoningEffort {
		values = append([]string(nil), legacyReasoningEfforts...)
	}
	if len(values) == 0 {
		capabilities.ReasoningEffort = false
		capabilities.ReasoningEfforts = nil
		return capabilities
	}
	capabilities.ReasoningEffort = true
	capabilities.ReasoningEfforts = values
	return capabilities
}

func canonicalReasoningEffortValues(values []string) []string {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		for _, known := range canonicalReasoningEfforts {
			if value == known {
				seen[value] = true
				break
			}
		}
	}
	out := make([]string, 0, len(seen))
	for _, known := range canonicalReasoningEfforts {
		if seen[known] {
			out = append(out, known)
		}
	}
	return out
}

// SupportsReasoningEffort reports whether a provider can accept a concrete
// non-auto reasoning effort. Empty and auto are always safe because adapters
// omit the upstream reasoning parameter for those values.
func (capabilities Capabilities) SupportsReasoningEffort(raw string) bool {
	effort := strings.ToLower(strings.TrimSpace(raw))
	if effort == "" || effort == "auto" {
		return true
	}
	for _, value := range canonicalCapabilities(capabilities).ReasoningEfforts {
		if effort == value {
			return true
		}
	}
	return false
}

func normalizeReasoningEffort(raw string, supported bool, providerName string) (string, error) {
	return normalizeReasoningEffortForCapabilities(raw, Capabilities{ReasoningEffort: supported}, providerName)
}

func normalizeReasoningEffortForCapabilities(raw string, capabilities Capabilities, providerName string) (string, error) {
	effort := strings.ToLower(strings.TrimSpace(raw))
	switch effort {
	case "", "auto":
		return "", nil
	case "low", "medium", "high", "xhigh":
		if canonicalCapabilities(capabilities).SupportsReasoningEffort(effort) {
			return effort, nil
		}
		return "", fmt.Errorf("%w by %s provider (requested %q)", ErrReasoningEffortUnsupported, strings.TrimSpace(providerName), effort)
	default:
		return "", fmt.Errorf("invalid reasoning effort %q: supported values are auto, low, medium, high, and xhigh", raw)
	}
}

func validateProviderRuntimeIdentity(cfg config.ProviderConfig) error {
	if err := validateClientVersion(cfg.ClientVersion); err != nil {
		return err
	}
	if err := validateInstallationID(cfg.InstallationID); err != nil {
		return err
	}
	return nil
}

func validateClientVersion(value string) error {
	if value == "" {
		return nil
	}
	if value != strings.TrimSpace(value) || len(value) > 64 || !clientVersionPattern.MatchString(value) {
		return fmt.Errorf("invalid Autoto client version %q: expected a semantic version without whitespace", value)
	}
	return nil
}

func validateInstallationID(value string) error {
	if value == "" {
		return nil
	}
	if value != strings.TrimSpace(value) || len(value) != 36 {
		return fmt.Errorf("invalid Autoto installation ID %q: expected a canonical UUIDv4", value)
	}
	parsed, err := uuid.Parse(value)
	if err != nil || parsed.String() != value || parsed.Version() != uuid.Version(4) || parsed.Variant() != uuid.RFC4122 {
		return fmt.Errorf("invalid Autoto installation ID %q: expected a canonical UUIDv4", value)
	}
	return nil
}

func autotoClientHeaderValue(cfg config.ProviderConfig) string {
	if cfg.ClientVersion == "" {
		return ""
	}
	return "autoto/" + cfg.ClientVersion
}
