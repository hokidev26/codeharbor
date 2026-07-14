package update

import (
	"fmt"
	"sort"
	"strings"
)

// Planner only computes paths through a previously validated manifest. It has
// no downloader, process runner, filesystem mutation, or network capability.
type Planner struct {
	manifest Manifest
}

// Plan is an inert description of the selected metadata path.
type Plan struct {
	Channel         string `json:"channel"`
	CurrentVersion  string `json:"currentVersion"`
	TargetVersion   string `json:"targetVersion"`
	Steps           []Edge `json:"steps"`
	RequiresBackup  bool   `json:"requiresBackup"`
	RequiresRestart bool   `json:"requiresRestart"`
}

func NewPlanner(manifest Manifest) (*Planner, error) {
	if err := ValidateManifest(manifest); err != nil {
		return nil, err
	}
	return &Planner{manifest: cloneManifest(manifest)}, nil
}

// BuildPlan validates the manifest and computes a path in one call.
func BuildPlan(manifest Manifest, currentVersion, targetVersion, channel string) (Plan, error) {
	planner, err := NewPlanner(manifest)
	if err != nil {
		return Plan{}, err
	}
	return planner.Plan(currentVersion, targetVersion, channel)
}

// Plan selects the shortest deterministic edge path. An empty target selects
// the channel's sole terminal version. An empty channel is permitted only when
// the manifest contains exactly one effective channel.
func (p *Planner) Plan(currentVersion, targetVersion, channel string) (Plan, error) {
	if p == nil {
		return Plan{}, fmt.Errorf("%w: planner is nil", ErrInvalidManifest)
	}
	current, err := canonicalVersion(currentVersion)
	if err != nil {
		return Plan{}, fmt.Errorf("%w: currentVersion: %v", ErrInvalidManifest, err)
	}
	selectedChannel, err := p.selectChannel(channel)
	if err != nil {
		return Plan{}, err
	}
	target := strings.TrimSpace(targetVersion)
	if target == "" {
		target, err = p.terminalVersion(selectedChannel)
		if err != nil {
			return Plan{}, err
		}
	} else {
		target, err = canonicalVersion(target)
		if err != nil {
			return Plan{}, fmt.Errorf("%w: targetVersion: %v", ErrInvalidManifest, err)
		}
	}
	comparison, err := CompareVersions(current, target)
	if err != nil {
		return Plan{}, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if comparison > 0 {
		return Plan{}, fmt.Errorf("%w: %s -> %s", ErrDowngrade, current, target)
	}
	if comparison == 0 {
		return Plan{
			Channel:        selectedChannel,
			CurrentVersion: current,
			TargetVersion:  target,
			Steps:          []Edge{},
		}, nil
	}

	adjacency := make(map[string][]Edge)
	for _, edge := range p.manifest.Edges {
		edgeChannel, edgeErr := effectiveChannel(p.manifest.Channel, edge.Channel)
		if edgeErr != nil || edgeChannel != selectedChannel {
			continue
		}
		source, _ := canonicalVersion(edge.SourceVersion)
		adjacency[source] = append(adjacency[source], edge)
	}
	for source := range adjacency {
		sort.SliceStable(adjacency[source], func(left, right int) bool {
			leftTarget, _ := canonicalVersion(adjacency[source][left].TargetVersion)
			rightTarget, _ := canonicalVersion(adjacency[source][right].TargetVersion)
			comparison, _ := CompareVersions(leftTarget, rightTarget)
			if comparison == 0 {
				return leftTarget < rightTarget
			}
			return comparison < 0
		})
	}

	type candidate struct {
		version string
		steps   []Edge
	}
	queue := []candidate{{version: current}}
	visited := map[string]struct{}{current: {}}
	var selected []Edge
	for len(queue) > 0 {
		entry := queue[0]
		queue = queue[1:]
		for _, edge := range adjacency[entry.version] {
			next, _ := canonicalVersion(edge.TargetVersion)
			nextSteps := append(append([]Edge(nil), entry.steps...), cloneEdge(edge))
			if next == target {
				selected = nextSteps
				queue = nil
				break
			}
			if _, ok := visited[next]; ok {
				continue
			}
			visited[next] = struct{}{}
			queue = append(queue, candidate{version: next, steps: nextSteps})
		}
	}
	if len(selected) == 0 {
		return Plan{}, fmt.Errorf("%w: no %s path from %s to %s", ErrBrokenPath, selectedChannel, current, target)
	}

	plan := Plan{
		Channel:        selectedChannel,
		CurrentVersion: current,
		TargetVersion:  target,
		Steps:          selected,
	}
	for _, edge := range selected {
		plan.RequiresBackup = plan.RequiresBackup || edge.RequiresBackup
		plan.RequiresRestart = plan.RequiresRestart || edge.RequiresRestart
	}
	return plan, nil
}

func (p *Planner) selectChannel(requested string) (string, error) {
	if strings.TrimSpace(requested) != "" {
		selected, err := normalizeChannel(requested)
		if err != nil {
			return "", err
		}
		for _, edge := range p.manifest.Edges {
			channel, _ := effectiveChannel(p.manifest.Channel, edge.Channel)
			if channel == selected {
				return selected, nil
			}
		}
		return "", fmt.Errorf("%w: channel %s has no edges", ErrBrokenPath, selected)
	}
	channels := make(map[string]struct{})
	for _, edge := range p.manifest.Edges {
		channel, err := effectiveChannel(p.manifest.Channel, edge.Channel)
		if err != nil {
			return "", err
		}
		channels[channel] = struct{}{}
	}
	if len(channels) != 1 {
		return "", fmt.Errorf("%w: channel is required when manifest has %d channels", ErrInvalidManifest, len(channels))
	}
	for channel := range channels {
		return channel, nil
	}
	return "", fmt.Errorf("%w: manifest has no channels", ErrInvalidManifest)
}

func (p *Planner) terminalVersion(channel string) (string, error) {
	sources := make(map[string]struct{})
	targets := make(map[string]struct{})
	for _, edge := range p.manifest.Edges {
		edgeChannel, _ := effectiveChannel(p.manifest.Channel, edge.Channel)
		if edgeChannel != channel {
			continue
		}
		source, _ := canonicalVersion(edge.SourceVersion)
		target, _ := canonicalVersion(edge.TargetVersion)
		sources[source] = struct{}{}
		targets[target] = struct{}{}
	}
	terminal := ""
	for target := range targets {
		if _, hasOutgoing := sources[target]; hasOutgoing {
			continue
		}
		if terminal != "" {
			return "", fmt.Errorf("%w: channel %s has multiple terminal versions", ErrBrokenPath, channel)
		}
		terminal = target
	}
	if terminal == "" {
		return "", fmt.Errorf("%w: channel %s has no terminal version", ErrBrokenPath, channel)
	}
	return terminal, nil
}

func cloneEdge(edge Edge) Edge {
	clone := edge
	clone.Notes = append(Notes(nil), edge.Notes...)
	return clone
}
