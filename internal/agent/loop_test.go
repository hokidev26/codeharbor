package agent

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
	"codeharbor/internal/tools"
)

type scriptedProvider struct {
	mu       sync.Mutex
	requests []providers.GenerateRequest
	turns    [][]providers.Event
}

func (p *scriptedProvider) Name() string { return "fake" }
func (p *scriptedProvider) ListModels(context.Context) ([]string, error) {
	return []string{"test"}, nil
}
func (p *scriptedProvider) Generate(ctx context.Context, req providers.GenerateRequest) (<-chan providers.Event, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	idx := len(p.requests) - 1
	var events []providers.Event
	if idx < len(p.turns) {
		events = append([]providers.Event(nil), p.turns[idx]...)
	}
	p.mu.Unlock()
	out := make(chan providers.Event, len(events))
	go func() {
		defer close(out)
		for _, event := range events {
			select {
			case <-ctx.Done():
				return
			case out <- event:
			}
		}
	}()
	return out, nil
}

func (p *scriptedProvider) request(index int) providers.GenerateRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests[index]
}

func (p *scriptedProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

func TestRunnerAutoExecutesToolCallsAndRecordsUsage(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	if err := writeTestFile(projectDir, "note.txt", "hello from tool"); err != nil {
		t.Fatal(err)
	}
	store, narrator := newAgentTestStore(t, projectDir, "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "read note.txt"}); err != nil {
		t.Fatal(err)
	}

	provider := &scriptedProvider{turns: [][]providers.Event{
		{
			{Type: "usage", Usage: &providers.Usage{InputTokens: 11, OutputTokens: 3, CachedInputTokens: 2}},
			{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "tool-1", Name: "Read", Input: json.RawMessage(`{"file_path":"note.txt"}`)}},
			{Type: "done", Done: true, StopReason: "tool_use"},
		},
		{
			{Type: "usage", Usage: &providers.Usage{InputTokens: 7, OutputTokens: 5, ReasoningTokens: 1}},
			{Type: "text", Text: "file says hello"},
			{Type: "done", Done: true, StopReason: "end_turn"},
		},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 4})

	runner.Run(ctx, narrator.ID)

	updated, err := store.GetNarrator(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "idle" {
		t.Fatalf("expected idle narrator, got %q", updated.Status)
	}
	if provider.requestCount() != 2 {
		t.Fatalf("expected two provider turns, got %d", provider.requestCount())
	}
	second := provider.request(1)
	if !requestHasToolResult(second, "tool-1", false) {
		t.Fatalf("expected second request to include successful tool_result, got %+v", second.Messages)
	}
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "tool-1")
	if err != nil {
		t.Fatal(err)
	}
	if call.ToolName != "Read" || call.Status != "completed" || call.MessageID == "" {
		t.Fatalf("unexpected stored tool call: %+v", call)
	}
	messages, err := store.ListMessages(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 4 {
		t.Fatalf("expected user + tool_use + tool_result + final messages, got %d", len(messages))
	}
	if messages[3].Role != "assistant" || messages[3].ContentText != "file says hello" {
		t.Fatalf("unexpected final message: %+v", messages[3])
	}
	var apiCount, inputTokens, outputTokens int64
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM api_requests WHERE narrator_id = ?`, narrator.ID).Scan(&apiCount, &inputTokens, &outputTokens); err != nil {
		t.Fatal(err)
	}
	if apiCount != 2 || inputTokens != 18 || outputTokens != 8 {
		t.Fatalf("unexpected api request stats: count=%d input=%d output=%d", apiCount, inputTokens, outputTokens)
	}
}

func TestRunnerWaitsForBashApprovalAndAllowsOnce(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "run bash"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-1", Name: "Bash", Input: json.RawMessage(`{"command":"printf approved"}`)}}, {Type: "done", Done: true}},
		{{Type: "text", Text: "done"}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 3})
	done := make(chan struct{})
	go func() { runner.Run(ctx, narrator.ID); close(done) }()
	waitForPendingApproval(t, runner, narrator.ID, "bash-1")
	accepted, err := runner.ApproveToolCall(ctx, narrator.ID, "bash-1", ToolApprovalDecision{Decision: "allow_once", Reason: "ok", DecidedBy: "test"})
	if err != nil || !accepted {
		t.Fatalf("approval failed accepted=%v err=%v", accepted, err)
	}
	waitDone(t, done)
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "bash-1")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "completed" || call.PermissionDecidedBy != "test" {
		t.Fatalf("unexpected approved call: %+v", call)
	}
	if !requestHasToolResult(provider.request(1), "bash-1", false) {
		t.Fatalf("expected approved bash result to be fed back")
	}
}

func TestRunnerBashApprovalDenyFeedsErrorResult(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "run bash"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-deny", Name: "Bash", Input: json.RawMessage(`{"command":"printf denied"}`)}}, {Type: "done", Done: true}},
		{{Type: "text", Text: "handled denial"}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 3})
	done := make(chan struct{})
	go func() { runner.Run(ctx, narrator.ID); close(done) }()
	waitForPendingApproval(t, runner, narrator.ID, "bash-deny")
	accepted, err := runner.ApproveToolCall(ctx, narrator.ID, "bash-deny", ToolApprovalDecision{Decision: "deny", Reason: "no", DecidedBy: "test"})
	if err != nil || !accepted {
		t.Fatalf("deny approval failed accepted=%v err=%v", accepted, err)
	}
	waitDone(t, done)
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "bash-deny")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "denied" || call.PermissionDenyMessage != "no" {
		t.Fatalf("unexpected denied call: %+v", call)
	}
	if !requestHasToolResult(provider.request(1), "bash-deny", true) {
		t.Fatalf("expected denied bash result to be fed back as error")
	}
}

func TestRunnerBashApprovalAllowSessionSkipsSecondPrompt(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "run bash twice"}); err != nil {
		t.Fatal(err)
	}
	input := json.RawMessage(`{"command":"printf session"}`)
	provider := &scriptedProvider{turns: [][]providers.Event{
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-session-1", Name: "Bash", Input: input}}, {Type: "done", Done: true}},
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-session-2", Name: "Bash", Input: input}}, {Type: "done", Done: true}},
		{{Type: "text", Text: "done"}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 4})
	done := make(chan struct{})
	go func() { runner.Run(ctx, narrator.ID); close(done) }()
	waitForPendingApproval(t, runner, narrator.ID, "bash-session-1")
	accepted, err := runner.ApproveToolCall(ctx, narrator.ID, "bash-session-1", ToolApprovalDecision{Decision: "allow_session", Reason: "ok", DecidedBy: "test"})
	if err != nil || !accepted {
		t.Fatalf("session approval failed accepted=%v err=%v", accepted, err)
	}
	waitDone(t, done)
	if runnerPendingApprovalCount(runner) != 0 {
		t.Fatalf("expected no pending approvals, got %d", runnerPendingApprovalCount(runner))
	}
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "bash-session-2")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "completed" || call.PermissionDecisionReason != "allowed by permission mode" && call.PermissionDecisionReason != "auto-approved by built-in exec whitelist" {
		t.Fatalf("expected second session command to auto execute, got %+v", call)
	}
}

func TestRunnerInterruptCancelsPendingApproval(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "run bash"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-wait", Name: "Bash", Input: json.RawMessage(`{"command":"printf wait"}`)}}, {Type: "done", Done: true}}}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 2})
	done := make(chan struct{})
	go func() { runner.Run(ctx, narrator.ID); close(done) }()
	waitForPendingApproval(t, runner, narrator.ID, "bash-wait")
	interrupted, err := runner.Interrupt(ctx, narrator.ID)
	if err != nil || !interrupted {
		t.Fatalf("interrupt failed interrupted=%v err=%v", interrupted, err)
	}
	waitDone(t, done)
	if runnerPendingApprovalCount(runner) != 0 {
		t.Fatalf("expected pending approval cleanup")
	}
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "bash-wait")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "denied" {
		t.Fatalf("expected canceled approval to be denied, got %+v", call)
	}
}

func TestRunnerDangerBashIsBlockedWithoutApproval(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "delete"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "bash-danger", Name: "Bash", Input: json.RawMessage(`{"command":"rm -rf tmp"}`)}}, {Type: "done", Done: true}},
		{{Type: "text", Text: "blocked"}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 3})
	runner.Run(ctx, narrator.ID)
	if runnerPendingApprovalCount(runner) != 0 {
		t.Fatal("danger command should not create approvable pending state")
	}
	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "bash-danger")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "denied" || call.PermissionDecidedBy != "policy" {
		t.Fatalf("expected policy-denied danger command, got %+v", call)
	}
	if !requestHasToolResult(provider.request(1), "bash-danger", true) {
		t.Fatalf("expected danger block to be fed back as error")
	}
}

func TestWhitelistedExecMatcher(t *testing.T) {
	for _, command := range []string{"go test ./...", "go vet ./internal/...", "go build ./...", "npm test", "npm run lint", "git status --short", "git diff --stat"} {
		if !isWhitelistedExecCommand(command) {
			t.Fatalf("expected command to be whitelisted: %s", command)
		}
	}
	for _, command := range []string{"go test ./... && rm -rf tmp", "npm run deploy", "git clean -fdx", "echo ok > file"} {
		if isWhitelistedExecCommand(command) {
			t.Fatalf("expected command not to be whitelisted: %s", command)
		}
	}
}

func TestRunnerReturnsDeniedToolResultToModel(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "readOnly")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "write file"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{
			{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "tool-denied", Name: "Write", Input: json.RawMessage(`{"file_path":"x.txt","content":"x"}`)}},
			{Type: "done", Done: true, StopReason: "tool_use"},
		},
		{{Type: "text", Text: "cannot write in readOnly"}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 3})

	runner.Run(ctx, narrator.ID)

	call, err := store.GetToolCallByUseID(ctx, narrator.ID, "tool-denied")
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != "denied" {
		t.Fatalf("expected denied tool call, got %+v", call)
	}
	if !requestHasToolResult(provider.request(1), "tool-denied", true) {
		t.Fatalf("expected denied result to be fed back as error tool_result")
	}
}

func TestRunnerStopsAtMaxTurns(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	if err := writeTestFile(projectDir, "note.txt", "loop"); err != nil {
		t.Fatal(err)
	}
	store, narrator := newAgentTestStore(t, projectDir, "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "loop"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "tool-a", Name: "Read", Input: json.RawMessage(`{"file_path":"note.txt"}`)}}, {Type: "done", Done: true}},
		{{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "tool-b", Name: "Read", Input: json.RawMessage(`{"file_path":"note.txt"}`)}}, {Type: "done", Done: true}},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 2})

	err := runner.run(ctx, narrator.ID)
	if err == nil || !strings.Contains(err.Error(), "max turns") {
		t.Fatalf("expected max turns error, got %v", err)
	}
}

func TestRunnerSkipsAPIRequestForNotConfiguredProviderNotice(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "hello"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{{
		{Type: "text", Text: "provider is not configured"},
		{Type: "done", Done: true, StopReason: "not_configured"},
	}}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 1})

	runner.Run(ctx, narrator.ID)

	var count int64
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM api_requests WHERE narrator_id = ?`, narrator.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected no api_requests for local not_configured notice, got %d", count)
	}
}

func TestProviderMessageFromDBRestoresToolBlocks(t *testing.T) {
	blocks := []providers.ContentBlock{{Type: "tool_result", ToolUseID: "tool-1", ToolName: "Read", Output: "ok", IsError: true}}
	raw, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	message := providerMessageFromDB(db.Message{Role: "user", ContentJSON: raw, ContentText: "fallback"})
	if len(message.Blocks) != 1 || message.Blocks[0].Type != "tool_result" || !message.Blocks[0].IsError {
		t.Fatalf("unexpected provider message blocks: %+v", message.Blocks)
	}
}

func TestRunnerPendingRunCancelsActiveAndRerunsWithLatestMessages(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "first"}); err != nil {
		t.Fatal(err)
	}
	provider := &pendingProvider{started: make(chan struct{})}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 2})

	firstDone := make(chan struct{})
	go func() {
		runner.Run(ctx, narrator.ID)
		close(firstDone)
	}()
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider did not start")
	}
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "second"}); err != nil {
		t.Fatal(err)
	}
	runner.Run(ctx, narrator.ID)

	waitForAgentNarratorStatus(t, store, narrator.ID, "idle")
	select {
	case <-firstDone:
	case <-time.After(2 * time.Second):
		t.Fatal("first run did not finish after pending rerun")
	}
	if provider.requestCount() != 2 {
		t.Fatalf("expected canceled first turn plus pending rerun, got %d provider calls", provider.requestCount())
	}
	secondRequest := provider.request(1)
	if !requestHasUserText(secondRequest, "first") || !requestHasUserText(secondRequest, "second") {
		t.Fatalf("expected pending rerun to include both user messages, got %+v", secondRequest.Messages)
	}
	messages, err := store.ListMessages(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 || messages[2].Role != "assistant" || messages[2].ContentText != "handled latest" {
		t.Fatalf("unexpected pending rerun messages: %+v", messages)
	}
}

func TestRunnerInterruptCancelsProviderTurn(t *testing.T) {
	ctx := context.Background()
	store, narrator := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "wait"}); err != nil {
		t.Fatal(err)
	}
	provider := &blockingProvider{started: make(chan struct{})}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 2})

	done := make(chan struct{})
	go func() {
		runner.Run(ctx, narrator.ID)
		close(done)
	}()
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider did not start")
	}
	interrupted, err := runner.Interrupt(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !interrupted {
		t.Fatal("expected active run to be interrupted")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runner did not stop after interrupt")
	}
	updated, err := store.GetNarrator(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %q", updated.Status)
	}
}

type pendingProvider struct {
	mu       sync.Mutex
	requests []providers.GenerateRequest
	started  chan struct{}
	once     sync.Once
}

func (p *pendingProvider) Name() string { return "fake" }
func (p *pendingProvider) ListModels(context.Context) ([]string, error) {
	return []string{"test"}, nil
}
func (p *pendingProvider) Generate(ctx context.Context, req providers.GenerateRequest) (<-chan providers.Event, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	call := len(p.requests)
	p.mu.Unlock()
	if call == 1 {
		p.once.Do(func() { close(p.started) })
		return make(chan providers.Event), nil
	}
	out := make(chan providers.Event, 2)
	out <- providers.Event{Type: "text", Text: "handled latest"}
	out <- providers.Event{Type: "done", Done: true}
	close(out)
	return out, nil
}
func (p *pendingProvider) request(index int) providers.GenerateRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests[index]
}
func (p *pendingProvider) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

type blockingProvider struct {
	started chan struct{}
	once    sync.Once
}

func (p *blockingProvider) Name() string { return "fake" }
func (p *blockingProvider) ListModels(context.Context) ([]string, error) {
	return []string{"test"}, nil
}
func (p *blockingProvider) Generate(ctx context.Context, req providers.GenerateRequest) (<-chan providers.Event, error) {
	p.once.Do(func() { close(p.started) })
	return make(chan providers.Event), nil
}

func newAgentTestStore(t *testing.T, projectDir, permissionMode string) (*db.Store, db.Narrator) {
	t.Helper()
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, narrator, err := store.CreateProject(context.Background(), "Demo", "", projectDir, "fake:test", permissionMode)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, narrator
}

func newAgentTestRunner(store *db.Store, provider providers.Provider, cfg config.AgentConfig) *Runner {
	registry := providers.NewRegistry()
	registry.Register(provider)
	toolRegistry := tools.NewRegistry()
	tools.RegisterCore(toolRegistry)
	return NewRunner(store, registry, toolRegistry, NewHub(), cfg)
}

func waitForPendingApproval(t *testing.T, runner *Runner, narratorID, toolUseID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		runner.approvalMu.Lock()
		approval := runner.approvals[approvalKey(narratorID, toolUseID)]
		runner.approvalMu.Unlock()
		if approval != nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for approval %s", toolUseID)
}

func runnerPendingApprovalCount(runner *Runner) int {
	runner.approvalMu.Lock()
	defer runner.approvalMu.Unlock()
	return len(runner.approvals)
}

func waitDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for runner")
	}
}

func requestHasToolResult(req providers.GenerateRequest, toolUseID string, isError bool) bool {
	for _, message := range req.Messages {
		for _, block := range message.Blocks {
			if block.Type == "tool_result" && block.ToolUseID == toolUseID && block.IsError == isError {
				return true
			}
		}
	}
	return false
}

func requestHasUserText(req providers.GenerateRequest, text string) bool {
	for _, message := range req.Messages {
		if message.Role != "user" {
			continue
		}
		for _, block := range message.Blocks {
			if block.Type == "text" && strings.Contains(block.Text, text) {
				return true
			}
		}
	}
	return false
}

func waitForAgentNarratorStatus(t *testing.T, store *db.Store, narratorID, status string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		narrator, err := store.GetNarrator(context.Background(), narratorID)
		if err != nil {
			t.Fatal(err)
		}
		if narrator.Status == status {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for narrator status %q", status)
}

func writeTestFile(root, name, content string) error {
	result, err := (tools.WriteTool{}).Execute(context.Background(), tools.Call{ID: "setup", Name: "Write", Input: mustJSON(map[string]string{"file_path": name, "content": content})}, tools.Env{CWD: root})
	if err != nil {
		return err
	}
	if result.IsError {
		return errors.New(result.Output)
	}
	return nil
}

func mustJSON(value any) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}
