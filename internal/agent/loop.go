package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/review"
	"autoto/internal/skills"
	"autoto/internal/toolpipeline"
	"autoto/internal/tools"
)

type Runner struct {
	store               *db.Store
	providers           *providers.Registry
	tools               *tools.Registry
	toolOutputPipeline  tools.ToolOutputPipelineService
	hub                 *Hub
	cfg                 config.AgentConfig
	contextManagementMu sync.RWMutex
	contextManagement   config.ContextManagementConfig

	modelSettingsMu sync.RWMutex
	defaultModel    string
	summaryModel    string
	subagentModels  map[string]string
	subagentPools   map[string][]string

	continuationMu        sync.RWMutex
	continuationConfig    config.AgentConfig
	continuationRunLimits map[string]continuationLimits

	dynamicToolsMu sync.RWMutex
	toolSource     tools.ToolSource
	toolResolver   tools.Resolver

	backgroundMu sync.RWMutex
	background   tools.BackgroundTaskService

	reasoningMu            sync.RWMutex
	defaultReasoningEffort string

	runMu      sync.Mutex
	running    map[string]*activeRun
	compacting map[string]struct{}

	approvalMu    sync.Mutex
	approvals     map[string]*pendingApproval
	sessionGrants map[string]map[string]sessionGrant

	notifierMu sync.RWMutex
	notifier   Notifier

	planMu               sync.RWMutex
	reviewer             *review.Service
	planSnapshotProvider func(context.Context, string) (db.PlanSnapshot, error)
}

type activeRun struct {
	cancel                  context.CancelFunc
	pending                 bool
	interrupted             bool
	runID                   string
	triggerMessageID        string
	pendingRunID            string
	pendingTriggerMessageID string
}

var (
	ErrAgentBusy                  = errors.New("agent is busy")
	ErrRemoteExecutionUnavailable = errors.New("remote execution transport is not implemented")
)

type SourceSubmission struct {
	AgentID           string
	Prompt            string
	Source            string
	SourceID          string
	PermissionModeCap string
	DispatchID        string
	TriggerType       string
}

type NotificationEvent struct {
	Event               string
	TaskID              string
	RunID               string
	AgentID             string
	Status              string
	Error               string
	ToolUseID           string
	ToolName            string
	ExecutionGeneration int64
}

type Notifier interface {
	Notify(context.Context, NotificationEvent)
}

type runCompletion struct {
	pending          bool
	interrupted      bool
	runID            string
	triggerMessageID string
}

const (
	toolApprovalTimeout          = 10 * time.Minute
	maxToolResultPreviewBytes    = 4 * 1024
	maxToolEventInputBytes       = 16 * 1024
	maxToolEventInputStringBytes = 2 * 1024
	maxToolEventInputItems       = 32
	maxToolEventInputDepth       = 4
	defaultContextTokenLimit     = 120000
	contextKeepRecentMessages    = 8
	maxContextToolInputBytes     = 16 * 1024
	maxDeterministicSummary      = 8000
	maxSummaryModelBytes         = 32 * 1024
	maxSummaryLineRunes          = 240
	memoryInjectionLimit         = 5
	memoryContentMaxRunes        = 2000
)

func NewRunner(store *db.Store, providers *providers.Registry, toolRegistry *tools.Registry, hub *Hub, cfg config.AgentConfig) *Runner {
	runner := &Runner{store: store, providers: providers, tools: toolRegistry, toolOutputPipeline: toolpipeline.NewManager(), hub: hub, cfg: cfg, contextManagement: (config.ContextManagementConfig{}).Normalized(), continuationConfig: cfg, continuationRunLimits: make(map[string]continuationLimits), defaultReasoningEffort: "auto", running: make(map[string]*activeRun), compacting: make(map[string]struct{}), approvals: make(map[string]*pendingApproval), sessionGrants: make(map[string]map[string]sessionGrant)}
	runner.SetAgentModelSettings(cfg)
	if store != nil {
		if settings, err := store.GetRuntimeSettings(context.Background()); err == nil {
			runner.SetDefaultReasoningEffort(settings.DefaultReasoningEffort)
		}
	}
	return runner
}

// SetDynamicTools configures the optional dynamic listing and resolution
// surfaces without changing the constructor used by existing callers.
func (r *Runner) SetDynamicTools(source tools.ToolSource, resolver tools.Resolver) {
	if r == nil {
		return
	}
	r.dynamicToolsMu.Lock()
	r.toolSource = source
	r.toolResolver = resolver
	r.dynamicToolsMu.Unlock()
}

// SetDynamicToolSource is a convenience for services implementing both
// ToolSource and Resolver.
func (r *Runner) SetDynamicToolSource(source tools.ToolSource) {
	resolver, _ := source.(tools.Resolver)
	r.SetDynamicTools(source, resolver)
}

// SetToolSource is a compatibility alias for SetDynamicToolSource.
func (r *Runner) SetToolSource(source tools.ToolSource) {
	r.SetDynamicToolSource(source)
}

func (r *Runner) dynamicTools() (tools.ToolSource, tools.Resolver) {
	if r == nil {
		return nil, nil
	}
	r.dynamicToolsMu.RLock()
	defer r.dynamicToolsMu.RUnlock()
	return r.toolSource, r.toolResolver
}

// SetBackgroundTaskService installs the execution service used by background
// tools. App wiring may call this alongside the server's own setter.
func (r *Runner) SetBackgroundTaskService(service tools.BackgroundTaskService) {
	if r == nil {
		return
	}
	r.backgroundMu.Lock()
	r.background = service
	r.backgroundMu.Unlock()
}

func (r *Runner) backgroundTaskService() tools.BackgroundTaskService {
	if r == nil {
		return nil
	}
	r.backgroundMu.RLock()
	defer r.backgroundMu.RUnlock()
	return r.background
}

func (r *Runner) SetAgentModelSettings(cfg config.AgentConfig) {
	if r == nil {
		return
	}
	models := make(map[string]string, len(cfg.SubagentModels))
	for role, model := range cfg.SubagentModels {
		role = normalizeSubagentRole(role)
		model = strings.TrimSpace(model)
		if role != "" && model != "" {
			models[role] = model
		}
	}
	pools := make(map[string][]string, len(cfg.SubagentModelPools))
	for role, values := range cfg.SubagentModelPools {
		role = normalizeSubagentRole(role)
		if role == "" {
			continue
		}
		seen := make(map[string]struct{}, len(values))
		pool := make([]string, 0, len(values))
		for _, model := range values {
			model = strings.TrimSpace(model)
			if model == "" {
				continue
			}
			if _, exists := seen[model]; exists {
				continue
			}
			seen[model] = struct{}{}
			pool = append(pool, model)
		}
		if len(pool) > 0 {
			pools[role] = pool
		}
	}
	r.modelSettingsMu.Lock()
	r.defaultModel = strings.TrimSpace(cfg.DefaultModel)
	r.summaryModel = strings.TrimSpace(cfg.SummaryModel)
	r.subagentModels = models
	r.subagentPools = pools
	r.modelSettingsMu.Unlock()
}

func (r *Runner) SummaryModel() string {
	if r == nil {
		return ""
	}
	r.modelSettingsMu.RLock()
	model := r.summaryModel
	r.modelSettingsMu.RUnlock()
	return model
}

func (r *Runner) ResolveSubagentModel(role, explicitModel, parentModel string) (string, string, error) {
	role = normalizeSubagentRole(role)
	if role == "" {
		role = "general"
	}
	explicitModel = strings.TrimSpace(explicitModel)
	parentModel = strings.TrimSpace(parentModel)
	r.modelSettingsMu.RLock()
	preferred := strings.TrimSpace(r.subagentModels[role])
	pool := append([]string(nil), r.subagentPools[role]...)
	defaultModel := strings.TrimSpace(r.defaultModel)
	r.modelSettingsMu.RUnlock()
	allowed := func(model string) bool {
		if len(pool) == 0 {
			return true
		}
		for _, candidate := range pool {
			if candidate == model {
				return true
			}
		}
		return false
	}
	if explicitModel != "" {
		if !allowed(explicitModel) {
			return "", role, fmt.Errorf("model %s is not allowed for %s subagents", explicitModel, role)
		}
		return explicitModel, role, nil
	}
	for _, candidate := range []string{preferred, parentModel, defaultModel} {
		if candidate != "" && allowed(candidate) {
			return candidate, role, nil
		}
	}
	if len(pool) > 0 {
		return pool[0], role, nil
	}
	return "", role, errors.New("subagent model is not configured")
}

func normalizeSubagentRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "", "background", "general":
		return "general"
	case "explore", "plan", "search":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return ""
	}
}

func (r *Runner) SetDefaultReasoningEffort(effort string) {
	effort = strings.ToLower(strings.TrimSpace(effort))
	if effort == "" {
		effort = "auto"
	}
	r.reasoningMu.Lock()
	r.defaultReasoningEffort = effort
	r.reasoningMu.Unlock()
}

func (r *Runner) reasoningEffort(agentEffort string) string {
	if effort := strings.ToLower(strings.TrimSpace(agentEffort)); effort != "" {
		return effort
	}
	r.reasoningMu.RLock()
	effort := r.defaultReasoningEffort
	r.reasoningMu.RUnlock()
	if effort == "" {
		return "auto"
	}
	return effort
}

func (r *Runner) EnsureLocalExecution(ctx context.Context, agentID string) error {
	if r == nil || r.store == nil {
		return errors.New("agent runner is not initialized")
	}
	agent, err := r.store.GetAgent(ctx, strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	if deviceID := strings.TrimSpace(agent.ExecutionDeviceID); deviceID != "" && deviceID != "local" {
		return fmt.Errorf("%w: agent %s targets device %s", ErrRemoteExecutionUnavailable, agent.ID, deviceID)
	}
	return nil
}

func (r *Runner) SetNotifier(notifier Notifier) {
	r.notifierMu.Lock()
	defer r.notifierMu.Unlock()
	r.notifier = notifier
}

func (r *Runner) notify(event NotificationEvent) {
	r.notifierMu.RLock()
	notifier := r.notifier
	r.notifierMu.RUnlock()
	if notifier == nil {
		return
	}
	if event.ExecutionGeneration == 0 && strings.TrimSpace(event.RunID) != "" && r.store != nil {
		if run, err := r.store.GetRunByID(context.Background(), event.RunID); err == nil {
			event.ExecutionGeneration = run.ExecutionGeneration
		}
	}
	notifier.Notify(context.Background(), event)
}

var serverSkillCommandPattern = regexp.MustCompile(`^(/[A-Za-z0-9][A-Za-z0-9_-]{0,62})(?:$|[ \t\r\n]+([\s\S]*))`)

func (r *Runner) SubmitUserMessage(ctx context.Context, agentID, text, createdBy string, attachments ...db.Attachment) (db.Message, error) {
	agent, err := r.store.GetAgent(ctx, agentID)
	if err != nil {
		return db.Message{}, err
	}
	return r.submitUserMessageWithMode(ctx, agentID, text, createdBy, runExecutionModeForAgent(agent), attachments...)
}

// SubmitUserMessageWithMode freezes an explicit capability boundary directly on
// the new Run. It never mutates the Agent's persisted default, so concurrent
// submissions cannot observe a transient Plan/Execute selection.
func (r *Runner) SubmitUserMessageWithMode(ctx context.Context, agentID, text, createdBy string, mode ExecutionMode, attachments ...db.Attachment) (db.Message, error) {
	return r.SubmitUserMessageWithModeAndPermissionCap(ctx, agentID, text, createdBy, mode, "", attachments...)
}

// SubmitUserMessageWithModeAndPermissionCap freezes a request-scoped
// permission ceiling on the durable Run. It never rewrites the Agent's default
// permission mode, so a restricted remote submission cannot affect later local
// work or a concurrent full session.
func (r *Runner) SubmitUserMessageWithModeAndPermissionCap(ctx context.Context, agentID, text, createdBy string, mode ExecutionMode, permissionModeCap string, attachments ...db.Attachment) (db.Message, error) {
	return r.SubmitUserMessageWithModePermissionCapAndSource(ctx, agentID, text, createdBy, mode, permissionModeCap, db.RunSourceManual, attachments...)
}

// SubmitUserMessageWithModePermissionCapAndSource additionally freezes the Run
// source. Conversation runs are always execute-mode, read-only research runs;
// callers cannot widen them by supplying a project execution mode or cap.
func (r *Runner) SubmitUserMessageWithModePermissionCapAndSource(ctx context.Context, agentID, text, createdBy string, mode ExecutionMode, permissionModeCap, runSource string, attachments ...db.Attachment) (db.Message, error) {
	var durableMode string
	switch mode {
	case ExecutionModePlan:
		durableMode = db.RunExecutionModePlan
	case ExecutionModeExecute:
		durableMode = db.RunExecutionModeExecute
	default:
		return db.Message{}, fmt.Errorf("invalid execution mode %q", mode)
	}
	permissionModeCap = strings.TrimSpace(permissionModeCap)
	if permissionModeCap != "" && permissionModeCap != "readOnly" && permissionModeCap != "acceptEdits" {
		return db.Message{}, fmt.Errorf("invalid permission mode cap %q", permissionModeCap)
	}
	runSource = strings.TrimSpace(runSource)
	if runSource == "" {
		runSource = db.RunSourceManual
	}
	switch runSource {
	case db.RunSourceManual:
		// Keep the requested project capability boundary.
	case db.RunSourceConversation:
		durableMode = db.RunExecutionModeExecute
		permissionModeCap = "readOnly"
	default:
		return db.Message{}, fmt.Errorf("invalid user message run source %q", runSource)
	}
	return r.submitUserMessageWithModeAndPermissionCap(ctx, agentID, text, createdBy, durableMode, permissionModeCap, runSource, attachments...)
}

func (r *Runner) submitUserMessageWithMode(ctx context.Context, agentID, text, createdBy, mode string, attachments ...db.Attachment) (db.Message, error) {
	return r.submitUserMessageWithModeAndPermissionCap(ctx, agentID, text, createdBy, mode, "", db.RunSourceManual, attachments...)
}

func (r *Runner) submitUserMessageWithModeAndPermissionCap(ctx context.Context, agentID, text, createdBy, mode, permissionModeCap, runSource string, attachments ...db.Attachment) (db.Message, error) {
	if err := r.EnsureLocalExecution(ctx, agentID); err != nil {
		return db.Message{}, err
	}
	if mode != db.RunExecutionModePlan && mode != db.RunExecutionModeExecute {
		return db.Message{}, errors.New("invalid durable run execution mode")
	}
	if _, err := r.cancelPendingContinuationsForAgent(ctx, agentID, "preempted by a new user message"); err != nil && !errors.Is(err, errContinuationStoreUnavailable) {
		return db.Message{}, err
	}
	contentText, commandText, err := r.expandServerSkillCommand(ctx, agentID, text)
	if err != nil {
		return db.Message{}, err
	}
	msg, err := r.store.AddMessageWithAttachments(ctx, db.Message{AgentID: agentID, Role: "user", ContentText: contentText, CommandText: commandText, CreatedBy: createdBy}, attachments)
	if err != nil {
		return db.Message{}, err
	}
	runRequest, err := r.bindPlanRunSnapshot(ctx, db.Run{AgentID: agentID, TriggerMessageID: msg.ID, Status: "pending", Source: runSource, ExecutionMode: mode, PermissionModeCap: permissionModeCap})
	if err != nil {
		return db.Message{}, err
	}
	runRequest, err = r.prepareContinuationRun(ctx, runRequest)
	if err != nil {
		return db.Message{}, err
	}
	run, err := r.store.CreateRun(ctx, runRequest)
	if err != nil {
		return db.Message{}, err
	}
	if err := r.store.AssignMessageRun(ctx, agentID, msg.ID, run.ID); err != nil {
		return db.Message{}, err
	}
	msg.RunID = run.ID
	r.publish(Event{Type: "message.created", AgentID: agentID, MessageID: msg.ID, Text: text, Data: mergeEventData(map[string]any{"attachments": len(msg.Attachments), "executionMode": mode}, run.ID)})
	go r.runWithRun(context.Background(), agentID, run.ID, msg.ID)
	return msg, nil
}

// SubmitCorrection creates an immutable follow-up to a user message and starts a
// new run. It intentionally does not alter the source message or reuse its run.
func (r *Runner) SubmitCorrection(ctx context.Context, agentID, sourceMessageID, text, createdBy string, keepAttachmentIDs []string, attachments ...db.Attachment) (db.Message, error) {
	return r.SubmitCorrectionWithSource(ctx, agentID, sourceMessageID, text, createdBy, keepAttachmentIDs, db.RunSourceManual, attachments...)
}

func (r *Runner) SubmitCorrectionWithSource(ctx context.Context, agentID, sourceMessageID, text, createdBy string, keepAttachmentIDs []string, runSource string, attachments ...db.Attachment) (db.Message, error) {
	if err := r.EnsureLocalExecution(ctx, agentID); err != nil {
		return db.Message{}, err
	}
	runSource = strings.TrimSpace(runSource)
	if runSource == "" {
		runSource = db.RunSourceManual
	}
	if runSource != db.RunSourceManual && runSource != db.RunSourceConversation {
		return db.Message{}, fmt.Errorf("invalid correction run source %q", runSource)
	}
	agent, err := r.store.GetAgent(ctx, agentID)
	if err != nil {
		return db.Message{}, err
	}
	// CreateCorrectionWithRun predates runs.execution_mode and always creates an
	// execute run. A project correction must not silently widen plan mode, while
	// an ordinary conversation correction is independently forced to read-only.
	if agent.PlanMode && runSource != db.RunSourceConversation {
		return db.Message{}, errors.New("plan-mode corrections require an execution-mode-aware Store API")
	}
	contentText, commandText, err := r.expandServerSkillCommand(ctx, agentID, text)
	if err != nil {
		return db.Message{}, err
	}
	msg, run, err := r.store.CreateCorrectionWithRun(ctx, agentID, sourceMessageID, contentText, commandText, createdBy, keepAttachmentIDs, attachments)
	if err != nil {
		return db.Message{}, err
	}
	run, err = r.store.BindPendingCorrectionRun(ctx, run.ID, runSource)
	if err != nil {
		return db.Message{}, err
	}
	r.publish(Event{Type: "message.created", AgentID: agentID, MessageID: msg.ID, Text: text, Data: mergeEventData(map[string]any{"attachments": len(msg.Attachments), "correctionOfMessageId": sourceMessageID}, run.ID)})
	go r.runWithRun(context.Background(), agentID, run.ID, msg.ID)
	return msg, nil
}

func (r *Runner) SubmitSchedule(ctx context.Context, schedule db.Schedule) (db.Run, error) {
	return r.SubmitScheduleDispatch(ctx, schedule, db.NewID())
}

func (r *Runner) SubmitScheduleDispatch(ctx context.Context, schedule db.Schedule, dispatchID string) (db.Run, error) {
	return r.SubmitSource(ctx, SourceSubmission{
		AgentID:           schedule.AgentID,
		Prompt:            schedule.Prompt,
		Source:            "schedule",
		SourceID:          schedule.ID,
		PermissionModeCap: schedule.PermissionMode,
		DispatchID:        dispatchID,
		TriggerType:       "scheduled",
	})
}

func (r *Runner) SubmitScheduleRun(ctx context.Context, schedule db.Schedule) (db.Run, error) {
	return r.SubmitSchedule(ctx, schedule)
}

func (r *Runner) SubmitInternal(ctx context.Context, agentID, sourceID, prompt, permissionModeCap string) (db.Run, error) {
	return r.SubmitSource(ctx, SourceSubmission{
		AgentID:           agentID,
		Prompt:            prompt,
		Source:            "internal",
		SourceID:          sourceID,
		PermissionModeCap: permissionModeCap,
		TriggerType:       "internal",
	})
}

func (r *Runner) SubmitSource(ctx context.Context, submission SourceSubmission) (db.Run, error) {
	if r == nil || r.store == nil {
		return db.Run{}, errors.New("agent runner is not initialized")
	}
	submission.AgentID = strings.TrimSpace(submission.AgentID)
	submission.Prompt = strings.TrimSpace(submission.Prompt)
	submission.Source = strings.TrimSpace(submission.Source)
	submission.SourceID = strings.TrimSpace(submission.SourceID)
	submission.PermissionModeCap = strings.TrimSpace(submission.PermissionModeCap)
	submission.DispatchID = strings.TrimSpace(submission.DispatchID)
	submission.TriggerType = strings.TrimSpace(submission.TriggerType)
	if submission.AgentID == "" || submission.Prompt == "" || submission.SourceID == "" {
		return db.Run{}, errors.New("agent, prompt, and source id are required")
	}
	switch submission.Source {
	case "schedule":
		if submission.DispatchID == "" {
			return db.Run{}, errors.New("scheduled source requires a dispatch id")
		}
		if submission.TriggerType != "scheduled" {
			return db.Run{}, errors.New("scheduled source requires scheduled trigger type")
		}
	case "internal":
		if submission.TriggerType != "internal" {
			return db.Run{}, errors.New("internal source requires internal trigger type")
		}
	default:
		return db.Run{}, errors.New("source must be schedule or internal")
	}
	if len(submission.DispatchID) > 256 {
		return db.Run{}, errors.New("dispatch id exceeds size limit")
	}
	if submission.PermissionModeCap != "readOnly" && submission.PermissionModeCap != "acceptEdits" {
		return db.Run{}, errors.New("permission mode cap must be readOnly or acceptEdits")
	}
	if err := ctx.Err(); err != nil {
		return db.Run{}, err
	}
	if err := r.EnsureLocalExecution(ctx, submission.AgentID); err != nil {
		return db.Run{}, err
	}
	agent, err := r.store.GetAgent(ctx, submission.AgentID)
	if err != nil {
		return db.Run{}, err
	}
	if submission.DispatchID != "" {
		existing, found, err := r.runForDispatch(ctx, submission.DispatchID)
		if err != nil {
			return db.Run{}, err
		}
		if found {
			if existing.AgentID != submission.AgentID || existing.Source != submission.Source || existing.SourceID != submission.SourceID || existing.TriggerType != submission.TriggerType {
				return db.Run{}, fmt.Errorf("%w: dispatch id belongs to another submission", db.ErrConflict)
			}
			return existing, nil
		}
	}

	runRequest, err := r.bindPlanRunSnapshot(ctx, db.Run{
		AgentID:           submission.AgentID,
		Status:            "pending",
		Source:            submission.Source,
		SourceID:          submission.SourceID,
		PermissionModeCap: submission.PermissionModeCap,
		DispatchID:        submission.DispatchID,
		TriggerType:       submission.TriggerType,
		ExecutionMode:     runExecutionModeForAgent(agent),
	})
	if err != nil {
		return db.Run{}, err
	}
	runRequest, err = r.prepareContinuationRun(ctx, runRequest)
	if err != nil {
		return db.Run{}, err
	}

	r.runMu.Lock()
	if r.running == nil {
		r.running = make(map[string]*activeRun)
	}
	if r.running[submission.AgentID] != nil {
		r.runMu.Unlock()
		return db.Run{}, ErrAgentBusy
	}
	if _, compacting := r.compacting[submission.AgentID]; compacting {
		r.runMu.Unlock()
		return db.Run{}, ErrAgentBusy
	}
	var durableBusy int
	if err := r.store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM runs WHERE agent_id = ? AND status IN ('pending','running')`, submission.AgentID).Scan(&durableBusy); err != nil {
		r.runMu.Unlock()
		return db.Run{}, err
	}
	if durableBusy > 0 {
		r.runMu.Unlock()
		return db.Run{}, ErrAgentBusy
	}
	msg, err := r.store.AddMessage(ctx, db.Message{AgentID: submission.AgentID, Role: "user", ContentText: submission.Prompt})
	if err != nil {
		r.runMu.Unlock()
		return db.Run{}, err
	}
	runRequest.TriggerMessageID = msg.ID
	run, err := r.store.CreateRun(ctx, runRequest)
	if err != nil {
		r.runMu.Unlock()
		return db.Run{}, err
	}
	if err := r.store.AssignMessageRun(ctx, submission.AgentID, msg.ID, run.ID); err != nil {
		r.runMu.Unlock()
		return db.Run{}, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	active := &activeRun{cancel: cancel, runID: run.ID, triggerMessageID: msg.ID}
	r.running[submission.AgentID] = active
	r.runMu.Unlock()

	msg.RunID = run.ID
	r.publish(Event{Type: "message.created", AgentID: submission.AgentID, MessageID: msg.ID, Text: submission.Prompt, Data: mergeEventData(map[string]any{"source": submission.Source, "sourceId": submission.SourceID}, run.ID)})
	go r.executeRegisteredRun(runCtx, submission.AgentID, active)
	return run, nil
}

func (r *Runner) runForDispatch(ctx context.Context, dispatchID string) (db.Run, bool, error) {
	var runID, agentID string
	err := r.store.DB().QueryRowContext(ctx, `SELECT id, agent_id FROM runs WHERE dispatch_id = ?`, dispatchID).Scan(&runID, &agentID)
	if db.IsNotFound(err) {
		return db.Run{}, false, nil
	}
	if err != nil {
		return db.Run{}, false, err
	}
	run, err := r.store.GetRun(ctx, agentID, runID)
	if err != nil {
		return db.Run{}, false, err
	}
	return run, true, nil
}

func (r *Runner) ActiveRunCount() int {
	if r == nil {
		return 0
	}
	r.runMu.Lock()
	defer r.runMu.Unlock()
	return len(r.running)
}

func (r *Runner) expandServerSkillCommand(ctx context.Context, values ...string) (contentText, commandText string, err error) {
	if len(values) == 0 || len(values) > 2 {
		return "", "", errors.New("skill command expansion requires text")
	}
	agentID, text := "", values[0]
	if len(values) == 2 {
		agentID, text = values[0], values[1]
	}
	match := serverSkillCommandPattern.FindStringSubmatch(text)
	if match == nil {
		return text, "", nil
	}
	var skill db.Skill
	if agentID == "" {
		skill, err = r.store.GetSkillByCommand(ctx, match[1])
	} else {
		skill, err = r.store.ResolveSkillByAgentAndCommand(ctx, agentID, match[1])
	}
	if db.IsNotFound(err) {
		return text, "", nil
	}
	if err != nil {
		return "", "", err
	}
	if err := validateServerSkillInvocation(skill); err != nil {
		return "", "", err
	}
	contentText = skill.Prompt
	if args := strings.TrimSpace(match[2]); args != "" {
		contentText += "\n\nUser arguments:\n" + args
	}
	return contentText, text, nil
}

func validateServerSkillInvocation(skill db.Skill) error {
	unavailable := func(reason string) error {
		return fmt.Errorf("%w: server skill %s %s", db.ErrConflict, skill.Command, reason)
	}
	if !skill.Enabled {
		return unavailable("is disabled")
	}
	if skill.ScannerVersion != skills.ScannerVersion {
		return unavailable("requires scanner revalidation")
	}
	normalized, err := skills.Normalize(skills.Skill{Name: skill.Name, Command: skill.Command, Description: skill.Description, Prompt: skill.Prompt})
	if err != nil || normalized.Name != skill.Name || normalized.Command != skill.Command || normalized.Description != skill.Description || normalized.Prompt != skill.Prompt {
		return unavailable("has invalid stored content")
	}
	result := skills.Scan(normalized)
	if result.Hash != skill.ContentHash {
		return unavailable("has stale content metadata")
	}
	if result.Verdict != skill.ScanVerdict {
		return unavailable("has stale scan metadata")
	}
	switch skill.ScanVerdict {
	case skills.VerdictSafe:
		return nil
	case skills.VerdictReview:
		acknowledgedAt := strings.TrimSpace(skill.RiskAcknowledgedAt)
		acknowledgedBy := strings.TrimSpace(skill.RiskAcknowledgedBy)
		if acknowledgedAt == "" || acknowledgedBy == "" || len(acknowledgedBy) > 200 || strings.TrimSpace(skill.RiskAcknowledgedHash) != skill.ContentHash {
			return unavailable("requires acknowledgement for the current content")
		}
		if _, err := time.Parse(time.RFC3339Nano, acknowledgedAt); err != nil {
			return unavailable("has an invalid risk acknowledgement")
		}
		return nil
	case skills.VerdictBlocked:
		return unavailable("is blocked")
	default:
		return unavailable("has an invalid scan verdict")
	}
}

func (r *Runner) RunWithTrigger(ctx context.Context, agentID, triggerMessageID string) {
	r.runWithRun(ctx, agentID, "", triggerMessageID)
}

func (r *Runner) Run(ctx context.Context, agentID string) {
	r.runWithRun(ctx, agentID, "", "")
}

func (r *Runner) runWithRun(ctx context.Context, agentID, runID, triggerMessageID string) {
	runCtx, active, started, registerErr := r.registerRun(ctx, agentID, runID, triggerMessageID)
	if registerErr != nil {
		slog.Error("register agent run failed", "agentId", agentID, "runId", runID, "error", registerErr)
		_ = r.store.SetAgentStatus(context.Background(), agentID, "error", registerErr.Error())
		if runID != "" {
			r.captureRunEndHead(runID)
			_ = r.store.CompleteRun(context.Background(), runID, "error", registerErr.Error())
		}
		r.publish(Event{Type: "agent.error", AgentID: agentID, Text: registerErr.Error(), Data: runEventData(runID)})
		r.notify(NotificationEvent{Event: "error", RunID: runID, AgentID: agentID, Status: "error", Error: registerErr.Error()})
		return
	}
	if !started {
		return
	}

	r.executeRegisteredRun(runCtx, agentID, active)
}

func (r *Runner) executeRegisteredRun(runCtx context.Context, agentID string, active *activeRun) {
	err := r.run(runCtx, agentID, active.runID)
	if err != nil && active != nil {
		r.closeToolOutputPipelineRun(agentID, active.runID)
	}
	completion := r.unregisterRun(agentID, active)
	if err == nil && active != nil && strings.TrimSpace(active.runID) != "" {
		r.resumeReadyBackgroundContinuation(active.runID)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			if completion.interrupted || !completion.pending {
				slog.Info("agent loop interrupted", "agentId", agentID, "runId", activeRunID(active))
				_ = r.store.SetAgentStatus(context.Background(), agentID, "interrupted", "")
				if active != nil && active.runID != "" {
					r.captureRunEndHead(active.runID)
					_ = r.store.CompleteRun(context.Background(), active.runID, "interrupted", "")
				}
				r.publish(Event{Type: "agent.interrupted", AgentID: agentID, Data: runEventData(activeRunID(active))})
				r.notify(NotificationEvent{Event: "interrupted", RunID: activeRunID(active), AgentID: agentID, Status: "interrupted"})
				return
			}
			if active != nil && active.runID != "" {
				r.captureRunEndHead(active.runID)
				_ = r.store.CompleteRun(context.Background(), active.runID, "superseded", "")
				r.notify(NotificationEvent{Event: "superseded", RunID: active.runID, AgentID: agentID, Status: "superseded"})
			}
			go r.runWithRun(context.Background(), agentID, completion.runID, completion.triggerMessageID)
			return
		}
		slog.Error("agent loop failed", "agentId", agentID, "runId", activeRunID(active), "error", err)
		_ = r.store.SetAgentStatus(context.Background(), agentID, "error", err.Error())
		if active != nil && active.runID != "" {
			r.captureRunEndHead(active.runID)
			_ = r.store.CompleteRun(context.Background(), active.runID, "error", err.Error())
		}
		r.publish(Event{Type: "agent.error", AgentID: agentID, Text: err.Error(), Data: runEventData(activeRunID(active))})
		r.notify(NotificationEvent{Event: "error", RunID: activeRunID(active), AgentID: agentID, Status: "error", Error: err.Error()})
		if completion.pending {
			go r.runWithRun(context.Background(), agentID, completion.runID, completion.triggerMessageID)
		}
		return
	}
	if completion.pending {
		go r.runWithRun(context.Background(), agentID, completion.runID, completion.triggerMessageID)
	}
}

func (r *Runner) Interrupt(ctx context.Context, agentID string) (bool, error) {
	if _, err := r.store.GetAgent(ctx, agentID); err != nil {
		return false, err
	}
	r.runMu.Lock()
	active := r.running[agentID]
	var cancel context.CancelFunc
	pendingRunID := ""
	if active != nil {
		pendingRunID = active.pendingRunID
		active.pending = false
		active.pendingRunID = ""
		active.pendingTriggerMessageID = ""
		active.interrupted = true
		cancel = active.cancel
	}
	r.runMu.Unlock()
	if pendingRunID != "" {
		r.captureRunEndHead(pendingRunID)
		_ = r.store.CompleteRun(context.Background(), pendingRunID, "interrupted", "")
		r.closeToolOutputPipelineRun(agentID, pendingRunID)
	}
	if cancel == nil {
		canceled, cancelErr := r.cancelPendingContinuationsForAgent(ctx, agentID, "interrupted by user")
		if cancelErr != nil && !errors.Is(cancelErr, errContinuationStoreUnavailable) {
			return false, cancelErr
		}
		if canceled > 0 {
			r.closeToolOutputPipelineAgent(agentID)
		}
		return canceled > 0, nil
	}
	cancel()
	return true, nil
}

func (r *Runner) registerRun(ctx context.Context, agentID, runID, triggerMessageID string) (context.Context, *activeRun, bool, error) {
	var runRequest db.Run
	if strings.TrimSpace(runID) == "" {
		agent, err := r.store.GetAgent(ctx, agentID)
		if err != nil {
			return nil, nil, false, err
		}
		runRequest, err = r.bindPlanRunSnapshot(ctx, db.Run{AgentID: agentID, TriggerMessageID: triggerMessageID, Status: "running", ExecutionMode: runExecutionModeForAgent(agent)})
		if err != nil {
			return nil, nil, false, err
		}
		runRequest, err = r.prepareContinuationRun(ctx, runRequest)
		if err != nil {
			return nil, nil, false, err
		}
	}
	r.runMu.Lock()
	if r.running == nil {
		r.running = make(map[string]*activeRun)
	}
	if _, compacting := r.compacting[agentID]; compacting {
		r.runMu.Unlock()
		return nil, nil, false, ErrAgentBusy
	}
	if active := r.running[agentID]; active != nil {
		// Keep only the newest queued request. Persistently supersede the prior
		// pending run before it can be forgotten by this in-memory slot.
		previousPending, previousRunID, previousTriggerID := active.pending, active.pendingRunID, active.pendingTriggerMessageID
		replacedPendingRunID := ""
		if runID != "" && active.pendingRunID != "" && active.pendingRunID != runID {
			replacedPendingRunID = active.pendingRunID
		}
		active.pending = true
		if runID != "" {
			active.pendingRunID = runID
		}
		if triggerMessageID != "" {
			active.pendingTriggerMessageID = triggerMessageID
		}
		cancel := active.cancel
		r.runMu.Unlock()
		if replacedPendingRunID != "" {
			r.captureRunEndHead(replacedPendingRunID)
			if err := r.store.CompleteRun(context.Background(), replacedPendingRunID, "superseded", ""); err != nil && !db.IsConflict(err) && !db.IsNotFound(err) {
				// Do not leave the old durable run stranded if its terminal write
				// failed. Restore it as the queued successor, then let the new run
				// follow its normal registration-error path.
				r.runMu.Lock()
				if r.running[agentID] == active && active.pendingRunID == runID {
					active.pending, active.pendingRunID, active.pendingTriggerMessageID = previousPending, previousRunID, previousTriggerID
				}
				r.runMu.Unlock()
				if cancel != nil {
					cancel()
				}
				return nil, nil, false, err
			}
		}
		if cancel != nil {
			cancel()
		}
		return nil, nil, false, nil
	}
	runCtx, cancel := context.WithCancel(ctx)
	active := &activeRun{cancel: cancel, runID: runID, triggerMessageID: triggerMessageID}
	if active.runID == "" {
		runningRun, err := r.store.CreateRun(context.Background(), runRequest)
		if err != nil {
			r.runMu.Unlock()
			cancel()
			return nil, nil, false, err
		}
		active.runID = runningRun.ID
		if triggerMessageID != "" {
			if err := r.store.AssignMessageRun(context.Background(), agentID, triggerMessageID, active.runID); err != nil {
				r.runMu.Unlock()
				cancel()
				return nil, nil, false, err
			}
		}
	} else if err := r.store.UpdateRunStatus(context.Background(), active.runID, "running", ""); err != nil {
		r.runMu.Unlock()
		cancel()
		return nil, nil, false, err
	}
	r.running[agentID] = active
	r.runMu.Unlock()
	return runCtx, active, true, nil
}

func (r *Runner) unregisterRun(agentID string, active *activeRun) runCompletion {
	completion := runCompletion{}
	r.runMu.Lock()
	if r.running[agentID] == active {
		completion.pending = active.pending
		completion.interrupted = active.interrupted
		completion.runID = active.pendingRunID
		completion.triggerMessageID = active.pendingTriggerMessageID
		delete(r.running, agentID)
	}
	r.runMu.Unlock()
	if active != nil && active.cancel != nil {
		active.cancel()
	}
	return completion
}
