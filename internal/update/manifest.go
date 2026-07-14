package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

var (
	ErrInvalidManifest = errors.New("invalid update manifest")
	ErrUnsafeField     = errors.New("unsafe update manifest field")
	ErrDowngrade       = errors.New("update downgrade is not allowed")
	ErrCycle           = errors.New("update manifest contains a cycle")
	ErrDuplicateEdge   = errors.New("update manifest contains a duplicate edge")
	ErrBrokenPath      = errors.New("update manifest contains a broken path")
)

const CurrentSchemaVersion = 1

// Manifest is inert update metadata. It contains no artifact, URL, script, or
// command fields and therefore cannot describe executable update behavior.
type Manifest struct {
	SchemaVersion int    `json:"schemaVersion,omitempty"`
	Channel       string `json:"channel,omitempty"`
	Edges         []Edge `json:"edges"`
}

// Edge describes one permitted, forward-only application version transition.
type Edge struct {
	SourceVersion   string           `json:"sourceVersion"`
	TargetVersion   string           `json:"targetVersion"`
	Channel         string           `json:"channel,omitempty"`
	DB              SchemaTransition `json:"db"`
	Config          SchemaTransition `json:"config"`
	Preferences     SchemaTransition `json:"preferences"`
	RequiresBackup  bool             `json:"requiresBackup"`
	RequiresRestart bool             `json:"requiresRestart"`
	Notes           Notes            `json:"notes,omitempty"`
}

// SchemaTransition records the expected schema before and after an edge.
type SchemaTransition struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type validatedEdge struct {
	edge    Edge
	source  string
	target  string
	channel string
}

// Notes accepts either a JSON string or an array of strings while exposing a
// single, predictable representation to callers.
type Notes []string

func (n *Notes) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*n = Notes{single}
		return nil
	}
	var many []string
	if err := json.Unmarshal(data, &many); err != nil {
		return fmt.Errorf("notes must be a string or an array of strings: %w", err)
	}
	*n = Notes(many)
	return nil
}

func (t *SchemaTransition) UnmarshalJSON(data []byte) error {
	var raw struct {
		From *int `json:"from"`
		To   *int `json:"to"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return err
	}
	if raw.From == nil || raw.To == nil {
		return errors.New("schema transition requires both from and to")
	}
	t.From = *raw.From
	t.To = *raw.To
	return nil
}

// ParseManifest rejects unknown fields and any script, URL, or command-shaped
// field at any nesting level before validating the update graph.
func ParseManifest(data []byte) (Manifest, error) {
	if err := rejectUnsafeFields(data); err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := decodeStrict(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return cloneManifest(manifest), nil
}

// Validate is a short alias for ValidateManifest.
func Validate(manifest Manifest) error {
	return ValidateManifest(manifest)
}

// ValidateManifest verifies that all edges are safe, forward-only, acyclic,
// unique, connected per channel, and schema-continuous.
func ValidateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != 0 && manifest.SchemaVersion != CurrentSchemaVersion {
		return fmt.Errorf("%w: unsupported schemaVersion %d", ErrInvalidManifest, manifest.SchemaVersion)
	}
	if manifest.Channel != "" {
		if _, err := normalizeChannel(manifest.Channel); err != nil {
			return err
		}
	}
	if len(manifest.Edges) == 0 {
		return fmt.Errorf("%w: at least one edge is required", ErrInvalidManifest)
	}

	validated := make([]validatedEdge, 0, len(manifest.Edges))
	seen := make(map[string]struct{}, len(manifest.Edges))
	for index, edge := range manifest.Edges {
		source, err := canonicalVersion(edge.SourceVersion)
		if err != nil {
			return fmt.Errorf("%w: edge %d sourceVersion: %v", ErrInvalidManifest, index, err)
		}
		target, err := canonicalVersion(edge.TargetVersion)
		if err != nil {
			return fmt.Errorf("%w: edge %d targetVersion: %v", ErrInvalidManifest, index, err)
		}
		channel, err := effectiveChannel(manifest.Channel, edge.Channel)
		if err != nil {
			return fmt.Errorf("%w: edge %d: %v", ErrInvalidManifest, index, err)
		}
		if err := validateTransition("db", edge.DB); err != nil {
			return fmt.Errorf("%w: edge %d: %w", ErrInvalidManifest, index, err)
		}
		if err := validateTransition("config", edge.Config); err != nil {
			return fmt.Errorf("%w: edge %d: %w", ErrInvalidManifest, index, err)
		}
		if err := validateTransition("preferences", edge.Preferences); err != nil {
			return fmt.Errorf("%w: edge %d: %w", ErrInvalidManifest, index, err)
		}
		for noteIndex, note := range edge.Notes {
			if strings.TrimSpace(note) == "" {
				return fmt.Errorf("%w: edge %d notes[%d] is empty", ErrInvalidManifest, index, noteIndex)
			}
		}
		key := channel + "\x00" + source + "\x00" + target
		if _, ok := seen[key]; ok {
			return fmt.Errorf("%w: %s %s -> %s", ErrDuplicateEdge, channel, source, target)
		}
		seen[key] = struct{}{}
		validated = append(validated, validatedEdge{edge: edge, source: source, target: target, channel: channel})
	}

	byChannel := make(map[string][]validatedEdge)
	for _, edge := range validated {
		byChannel[edge.channel] = append(byChannel[edge.channel], edge)
	}
	channels := make([]string, 0, len(byChannel))
	for channel := range byChannel {
		channels = append(channels, channel)
	}
	sort.Strings(channels)
	for _, channel := range channels {
		edges := byChannel[channel]
		if err := validateAcyclic(channel, edges); err != nil {
			return err
		}
		for _, edge := range edges {
			comparison, err := CompareVersions(edge.source, edge.target)
			if err != nil {
				return fmt.Errorf("%w: %v", ErrInvalidManifest, err)
			}
			if comparison >= 0 {
				return fmt.Errorf("%w: %s %s -> %s", ErrDowngrade, channel, edge.source, edge.target)
			}
		}
		if err := validateConnectedPath(channel, edges); err != nil {
			return err
		}
		if err := validateSchemaContinuity(channel, edges); err != nil {
			return err
		}
	}
	return nil
}

func validateTransition(name string, transition SchemaTransition) error {
	if transition.From < 0 || transition.To < 0 {
		return fmt.Errorf("%s schema versions must be non-negative", name)
	}
	if transition.To < transition.From {
		return fmt.Errorf("%w: %s schema %d -> %d", ErrDowngrade, name, transition.From, transition.To)
	}
	return nil
}

func validateAcyclic(channel string, edges []validatedEdge) error {
	adjacency := make(map[string][]string)
	for _, edge := range edges {
		adjacency[edge.source] = append(adjacency[edge.source], edge.target)
	}
	const (
		unseen = iota
		visiting
		visited
	)
	state := make(map[string]int)
	var visit func(string) bool
	visit = func(node string) bool {
		switch state[node] {
		case visiting:
			return true
		case visited:
			return false
		}
		state[node] = visiting
		for _, next := range adjacency[node] {
			if visit(next) {
				return true
			}
		}
		state[node] = visited
		return false
	}
	for node := range adjacency {
		if visit(node) {
			return fmt.Errorf("%w: channel %s", ErrCycle, channel)
		}
	}
	return nil
}

func validateConnectedPath(channel string, edges []validatedEdge) error {
	undirected := make(map[string][]string)
	sources := make(map[string]struct{})
	targets := make(map[string]struct{})
	for _, edge := range edges {
		undirected[edge.source] = append(undirected[edge.source], edge.target)
		undirected[edge.target] = append(undirected[edge.target], edge.source)
		sources[edge.source] = struct{}{}
		targets[edge.target] = struct{}{}
	}
	var start string
	for node := range undirected {
		start = node
		break
	}
	seen := map[string]struct{}{start: {}}
	queue := []string{start}
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		for _, next := range undirected[node] {
			if _, ok := seen[next]; ok {
				continue
			}
			seen[next] = struct{}{}
			queue = append(queue, next)
		}
	}
	if len(seen) != len(undirected) {
		return fmt.Errorf("%w: channel %s has disconnected edges", ErrBrokenPath, channel)
	}

	terminals := 0
	for target := range targets {
		if _, hasOutgoing := sources[target]; !hasOutgoing {
			terminals++
		}
	}
	if terminals != 1 {
		return fmt.Errorf("%w: channel %s must have exactly one terminal version", ErrBrokenPath, channel)
	}
	return nil
}

func validateSchemaContinuity(channel string, edges []validatedEdge) error {
	incoming := make(map[string][]Edge)
	outgoing := make(map[string][]Edge)
	for _, edge := range edges {
		incoming[edge.target] = append(incoming[edge.target], edge.edge)
		outgoing[edge.source] = append(outgoing[edge.source], edge.edge)
	}
	for version, before := range incoming {
		after := outgoing[version]
		for _, left := range before {
			for _, right := range after {
				if left.DB.To != right.DB.From {
					return fmt.Errorf("%w: channel %s db schema is discontinuous at %s", ErrBrokenPath, channel, version)
				}
				if left.Config.To != right.Config.From {
					return fmt.Errorf("%w: channel %s config schema is discontinuous at %s", ErrBrokenPath, channel, version)
				}
				if left.Preferences.To != right.Preferences.From {
					return fmt.Errorf("%w: channel %s preferences schema is discontinuous at %s", ErrBrokenPath, channel, version)
				}
			}
		}
	}
	return nil
}

var channelPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,31}$`)

func normalizeChannel(channel string) (string, error) {
	channel = strings.ToLower(strings.TrimSpace(channel))
	if !channelPattern.MatchString(channel) {
		return "", fmt.Errorf("%w: invalid channel %q", ErrInvalidManifest, channel)
	}
	return channel, nil
}

func effectiveChannel(defaultChannel, edgeChannel string) (string, error) {
	channel := edgeChannel
	if strings.TrimSpace(channel) == "" {
		channel = defaultChannel
	}
	if strings.TrimSpace(channel) == "" {
		return "", errors.New("channel is required")
	}
	return normalizeChannel(channel)
}

func decodeStrict(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("input must contain exactly one JSON value")
		}
		return err
	}
	return nil
}

func rejectUnsafeFields(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	var inspect func(any) error
	inspect = func(current any) error {
		switch typed := current.(type) {
		case map[string]any:
			for key, nested := range typed {
				normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
				if strings.Contains(normalized, "script") || strings.Contains(normalized, "command") || strings.Contains(normalized, "url") || normalized == "cmd" || strings.Contains(normalized, "uri") {
					return fmt.Errorf("%w: %q", ErrUnsafeField, key)
				}
				if err := inspect(nested); err != nil {
					return err
				}
			}
		case []any:
			for _, nested := range typed {
				if err := inspect(nested); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return inspect(value)
}

func cloneManifest(manifest Manifest) Manifest {
	clone := manifest
	clone.Edges = make([]Edge, len(manifest.Edges))
	for index, edge := range manifest.Edges {
		clone.Edges[index] = edge
		clone.Edges[index].Notes = append(Notes(nil), edge.Notes...)
	}
	return clone
}
