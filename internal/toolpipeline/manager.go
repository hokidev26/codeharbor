package toolpipeline

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"autoto/internal/tools"
)

const (
	defaultMaxCaptures     = 64
	defaultMaxTotalBytes   = 4 * 1024 * 1024
	defaultPreviewChars    = 100
	minimumPreviewChars    = 32
	maximumPreviewChars    = 512
	defaultMaxResultChars  = 12 * 1024
	maximumMaxResultChars  = 50 * 1024
	maximumPipelineLabel   = 200
	defaultPipelineIdleTTL = 10 * time.Minute
	maximumFinalLines      = 1000
)

type Limits struct {
	MaxCaptures    int
	MaxTotalBytes  int
	DefaultPreview int
	MinPreview     int
	MaxPreview     int
	DefaultResult  int
	MaxResult      int
	IdleTTL        time.Duration
}

type Manager struct {
	mu       sync.Mutex
	sessions map[pipelineKey]*pipelineSession
	limits   Limits
	now      func() time.Time
}

type pipelineKey struct {
	agentID string
	runID   string
}

type pipelineSession struct {
	label        string
	previewChars int
	nextAlias    int
	totalBytes   int
	createdAt    time.Time
	lastUsedAt   time.Time
	captures     []*capture
	byAlias      map[string]*capture
}

type capture struct {
	alias    string
	toolUse  string
	toolName string
	output   string
	isError  bool
	bytes    int
}

var _ tools.ToolOutputPipelineService = (*Manager)(nil)

func DefaultLimits() Limits {
	return Limits{
		MaxCaptures:    defaultMaxCaptures,
		MaxTotalBytes:  defaultMaxTotalBytes,
		DefaultPreview: defaultPreviewChars,
		MinPreview:     minimumPreviewChars,
		MaxPreview:     maximumPreviewChars,
		DefaultResult:  defaultMaxResultChars,
		MaxResult:      maximumMaxResultChars,
		IdleTTL:        defaultPipelineIdleTTL,
	}
}

func NewManager() *Manager {
	return NewManagerWithLimits(DefaultLimits())
}

func NewManagerWithLimits(limits Limits) *Manager {
	defaults := DefaultLimits()
	if limits.MaxCaptures <= 0 {
		limits.MaxCaptures = defaults.MaxCaptures
	}
	if limits.MaxTotalBytes <= 0 {
		limits.MaxTotalBytes = defaults.MaxTotalBytes
	}
	if limits.MinPreview <= 0 {
		limits.MinPreview = defaults.MinPreview
	}
	if limits.MaxPreview < limits.MinPreview {
		limits.MaxPreview = defaults.MaxPreview
	}
	if limits.DefaultPreview < limits.MinPreview || limits.DefaultPreview > limits.MaxPreview {
		limits.DefaultPreview = defaults.DefaultPreview
	}
	if limits.DefaultResult <= 0 {
		limits.DefaultResult = defaults.DefaultResult
	}
	if limits.MaxResult < limits.DefaultResult {
		limits.MaxResult = defaults.MaxResult
	}
	if limits.IdleTTL <= 0 {
		limits.IdleTTL = defaults.IdleTTL
	}
	return &Manager{sessions: make(map[pipelineKey]*pipelineSession), limits: limits, now: time.Now}
}

func (m *Manager) Start(scope tools.ToolOutputPipelineScope, options tools.ToolOutputPipelineStartOptions) tools.Result {
	key, ok := normalizedKey(scope)
	if !ok {
		return pipelineError("pipeline_run_required", "a durable agent and run are required")
	}
	if m == nil {
		return pipelineError("pipeline_unavailable", "tool output pipeline service is unavailable")
	}
	label := truncateRunes(strings.TrimSpace(options.Label), maximumPipelineLabel)
	previewChars := options.MaxPreviewChars
	if previewChars == 0 {
		previewChars = m.limits.DefaultPreview
	}
	if previewChars < m.limits.MinPreview || previewChars > m.limits.MaxPreview {
		return pipelineError("pipeline_rule_invalid", fmt.Sprintf("max_preview_chars must be between %d and %d", m.limits.MinPreview, m.limits.MaxPreview))
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.pruneExpiredLocked(now)
	if _, exists := m.sessions[key]; exists {
		return pipelineError("pipeline_already_active", "this run already has an active pipeline")
	}
	m.sessions[key] = &pipelineSession{
		label:        label,
		previewChars: previewChars,
		nextAlias:    1,
		createdAt:    now,
		lastUsedAt:   now,
		byAlias:      make(map[string]*capture),
	}
	output := "Pipeline started. Subsequent eligible tool results will be captured as p1, p2, ... and only short previews will be shown."
	if label != "" {
		output += "\nLabel: " + label
	}
	return tools.Result{Output: output, Meta: map[string]any{"pipelineActive": true, "maxPreviewChars": previewChars}}
}

func (m *Manager) End(scope tools.ToolOutputPipelineScope, options tools.ToolOutputPipelineEndOptions) tools.Result {
	key, ok := normalizedKey(scope)
	if !ok {
		return pipelineError("pipeline_run_required", "a durable agent and run are required")
	}
	if m == nil {
		return pipelineError("pipeline_unavailable", "tool output pipeline service is unavailable")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.pruneExpiredLocked(now)
	session, exists := m.sessions[key]
	if !exists {
		return pipelineError("pipeline_not_active", "this run has no active pipeline")
	}
	session.lastUsedAt = now
	if options.Discard {
		count := len(session.captures)
		delete(m.sessions, key)
		return tools.Result{Output: fmt.Sprintf("Pipeline discarded. Captures released: %d", count), Meta: map[string]any{"pipelineActive": false, "discarded": true, "captureCount": count}}
	}

	format := strings.ToLower(strings.TrimSpace(options.Format))
	if format == "" {
		format = "sections"
	}
	if format != "sections" && format != "plain" {
		return pipelineError("pipeline_rule_invalid", "format must be sections or plain")
	}
	maxChars := options.MaxChars
	if maxChars == 0 {
		maxChars = m.limits.DefaultResult
	}
	if maxChars < 1 || maxChars > m.limits.MaxResult {
		return pipelineError("pipeline_rule_invalid", fmt.Sprintf("max_chars must be between 1 and %d", m.limits.MaxResult))
	}
	parsed, err := parseRule(options.Rule)
	if err != nil {
		return pipelineErrorText(err.Error())
	}
	aliases := parsed.aliases
	if len(aliases) == 0 {
		aliases = append([]string(nil), options.Aliases...)
	}
	selected, selectedAliases, selectErr := selectCaptures(session, aliases)
	if selectErr != nil {
		return pipelineErrorText(selectErr.Error())
	}
	lines := captureLines(selected, format)
	lines, err = applyOperations(lines, parsed.operations)
	if err != nil {
		return pipelineErrorText(err.Error())
	}
	truncated := false
	if len(lines) > maximumFinalLines {
		lines = lines[:maximumFinalLines]
		truncated = true
	}
	content := strings.Join(lines, "\n")
	if strings.TrimSpace(content) == "" {
		content = "(no matching output)"
	}
	if bounded, wasTruncated := truncateCharacters(content, maxChars); wasTruncated {
		content = bounded
		truncated = true
	}
	normalizedRule := parsed.normalized
	if normalizedRule == "" {
		normalizedRule = "cat"
	}
	result := fmt.Sprintf(
		"Aliases: %s\nCaptures: %d\nRule: %s\nTruncated: %t\n\n%s",
		strings.Join(selectedAliases, ", "), len(selected), normalizedRule, truncated, content,
	)
	delete(m.sessions, key)
	return tools.Result{Output: result, Meta: map[string]any{
		"pipelineActive": false,
		"aliases":        selectedAliases,
		"captureCount":   len(selected),
		"rule":           normalizedRule,
		"truncated":      truncated,
	}}
}

func (m *Manager) ProcessResult(scope tools.ToolOutputPipelineScope, call tools.Call, result tools.Result) tools.Result {
	if m == nil || tools.IsToolOutputPipelineControl(call.Name) {
		return result
	}
	key, ok := normalizedKey(scope)
	if !ok {
		return result
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.pruneExpiredLocked(now)
	session, exists := m.sessions[key]
	if !exists {
		return result
	}
	session.lastUsedAt = now
	outputBytes := len(result.Output)
	if len(session.captures) >= m.limits.MaxCaptures {
		return captureLimitResult(result, "maximum capture count reached")
	}
	if outputBytes > m.limits.MaxTotalBytes-session.totalBytes {
		return captureLimitResult(result, "maximum captured byte total reached")
	}
	alias := fmt.Sprintf("p%d", session.nextAlias)
	session.nextAlias++
	captured := &capture{
		alias:    alias,
		toolUse:  strings.TrimSpace(call.ID),
		toolName: strings.TrimSpace(call.Name),
		output:   result.Output,
		isError:  result.IsError,
		bytes:    outputBytes,
	}
	session.captures = append(session.captures, captured)
	session.byAlias[alias] = captured
	session.totalBytes += outputBytes
	preview := previewText(result.Output, session.previewChars)
	modelOutput := fmt.Sprintf("Captured as %s\nTool: %s\nBytes: %d\nError: %t\nPreview: %s", alias, captured.toolName, outputBytes, result.IsError, preview)
	return tools.Result{Output: modelOutput, IsError: result.IsError, Meta: map[string]any{
		"pipelineAlias": alias,
		"capturedBytes": outputBytes,
		"toolUseId":     captured.toolUse,
	}}
}

func (m *Manager) IsActive(scope tools.ToolOutputPipelineScope) bool {
	if m == nil {
		return false
	}
	key, ok := normalizedKey(scope)
	if !ok {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneExpiredLocked(m.now())
	_, exists := m.sessions[key]
	return exists
}

func (m *Manager) CloseRun(scope tools.ToolOutputPipelineScope) {
	if m == nil {
		return
	}
	key, ok := normalizedKey(scope)
	if !ok {
		return
	}
	m.mu.Lock()
	delete(m.sessions, key)
	m.mu.Unlock()
}

func (m *Manager) CloseAgent(agentID string) {
	if m == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	agentID = strings.TrimSpace(agentID)
	m.mu.Lock()
	for key := range m.sessions {
		if key.agentID == agentID {
			delete(m.sessions, key)
		}
	}
	m.mu.Unlock()
}

func (m *Manager) pruneExpiredLocked(now time.Time) {
	for key, session := range m.sessions {
		if now.Sub(session.lastUsedAt) >= m.limits.IdleTTL {
			delete(m.sessions, key)
		}
	}
}

func normalizedKey(scope tools.ToolOutputPipelineScope) (pipelineKey, bool) {
	key := pipelineKey{agentID: strings.TrimSpace(scope.AgentID), runID: strings.TrimSpace(scope.RunID)}
	return key, key.agentID != "" && key.runID != ""
}

func selectCaptures(session *pipelineSession, aliases []string) ([]*capture, []string, error) {
	if len(aliases) == 0 {
		selected := append([]*capture(nil), session.captures...)
		names := make([]string, 0, len(selected))
		for _, captured := range selected {
			names = append(names, captured.alias)
		}
		return selected, names, nil
	}
	selected := make([]*capture, 0, len(aliases))
	names := make([]string, 0, len(aliases))
	seen := make(map[string]struct{}, len(aliases))
	for _, rawAlias := range aliases {
		alias := strings.TrimSpace(rawAlias)
		if !validAlias(alias) {
			return nil, nil, fmt.Errorf("pipeline_rule_invalid: invalid alias %q", rawAlias)
		}
		if _, duplicate := seen[alias]; duplicate {
			continue
		}
		captured, exists := session.byAlias[alias]
		if !exists {
			return nil, nil, fmt.Errorf("pipeline_alias_not_found: %s", alias)
		}
		seen[alias] = struct{}{}
		selected = append(selected, captured)
		names = append(names, alias)
	}
	return selected, names, nil
}

func captureLines(captures []*capture, format string) []string {
	lines := make([]string, 0)
	for index, captured := range captures {
		if format == "sections" {
			if index > 0 {
				lines = append(lines, "")
			}
			lines = append(lines, fmt.Sprintf("--- %s (%s) ---", captured.alias, captured.toolName))
		}
		lines = append(lines, splitOutputLines(captured.output)...)
	}
	return lines
}

func splitOutputLines(output string) []string {
	output = strings.ToValidUTF8(output, "�")
	output = strings.ReplaceAll(output, "\r\n", "\n")
	output = strings.ReplaceAll(output, "\r", "\n")
	if output == "" {
		return []string{""}
	}
	return strings.Split(strings.TrimSuffix(output, "\n"), "\n")
}

func previewText(output string, maximum int) string {
	output = strings.ToValidUTF8(output, "�")
	output = strings.ReplaceAll(output, "\x00", "�")
	if strings.TrimSpace(output) == "" {
		return "(empty)"
	}
	bounded, truncated := truncateCharacters(output, maximum)
	if truncated {
		return bounded + "…"
	}
	return bounded
}

func truncateCharacters(value string, maximum int) (string, bool) {
	value = strings.ToValidUTF8(value, "�")
	if maximum < 0 {
		maximum = 0
	}
	if utf8.RuneCountInString(value) <= maximum {
		return value, false
	}
	runes := []rune(value)
	return string(runes[:maximum]), true
}

func truncateRunes(value string, maximum int) string {
	bounded, _ := truncateCharacters(value, maximum)
	return bounded
}

func pipelineError(code, message string) tools.Result {
	return tools.Result{Output: code + ": " + message, IsError: true, Meta: map[string]any{"pipelineError": code}}
}

func pipelineErrorText(message string) tools.Result {
	code := strings.TrimSpace(strings.SplitN(message, ":", 2)[0])
	if code == "" {
		code = "pipeline_rule_invalid"
	}
	return tools.Result{Output: message, IsError: true, Meta: map[string]any{"pipelineError": code}}
}

func captureLimitResult(raw tools.Result, reason string) tools.Result {
	return tools.Result{
		Output:  fmt.Sprintf("pipeline_limit_exceeded: %s; result was not captured\nBytes: %d\nError: %t", reason, len(raw.Output), raw.IsError),
		IsError: raw.IsError,
		Meta:    map[string]any{"pipelineCaptureFailed": true, "pipelineError": "pipeline_limit_exceeded"},
	}
}
