package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/review"
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

func (r *Runner) ActiveRunCount() int {
	if r == nil {
		return 0
	}
	r.runMu.Lock()
	defer r.runMu.Unlock()
	return len(r.running)
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
