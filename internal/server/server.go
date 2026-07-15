package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	agentpkg "autoto/internal/agent"
	"autoto/internal/audit"
	"autoto/internal/automation"
	"autoto/internal/codexauth"
	"autoto/internal/compat"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/devices"
	"autoto/internal/integrations"
	"autoto/internal/preview"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

type agentMutationLock struct {
	mu   sync.Mutex
	refs int
}

type Server struct {
	cfg   config.Config
	cfgMu sync.RWMutex
	// providerMutationMu serializes config persistence with runtime registry
	// changes so concurrent PUT/PATCH/DELETE operations cannot lose updates.
	providerMutationMu   sync.Mutex
	providerMutationHook func()
	configPath           string
	startedAt            time.Time
	clock                func() time.Time
	localToken           string
	remoteAccessToken    string
	remoteAccessFailure  map[string]remoteAccessFailure
	remoteAccessMu       sync.Mutex
	agentMutationLocksMu sync.Mutex
	agentMutationLocks   map[string]*agentMutationLock
	legacyWarnings       *compat.Registry
	store                *db.Store
	runner               *agentpkg.Runner
	hub                  *agentpkg.Hub
	providers            *providers.Registry
	codexCredentials     *codexauth.Store
	toolRegistry         *tools.Registry
	toolRegistryMu       sync.RWMutex
	previewManager       *preview.Manager
	notifier             *WebhookNotifier
	automation           *automation.Manager
	connections          *integrations.ConnectionService
	plugins              PluginService
	audit                audit.Recorder
	integrationClient    *http.Client
	deviceAdapterFactory func(context.Context, string) (devices.Adapter, error)
}

func New(cfg config.Config, store *db.Store, runner *agentpkg.Runner, hub *agentpkg.Hub, providerRegistries ...*providers.Registry) *Server {
	var providerRegistry *providers.Registry
	if len(providerRegistries) > 0 {
		providerRegistry = providerRegistries[0]
	}
	return &Server{
		cfg:                 cfg,
		startedAt:           time.Now().UTC(),
		clock:               time.Now,
		localToken:          newLocalToken(),
		remoteAccessToken:   newLocalToken(),
		remoteAccessFailure: make(map[string]remoteAccessFailure),
		agentMutationLocks:  make(map[string]*agentMutationLock),
		legacyWarnings: compat.NewRegistry(func(usage compat.Usage) {
			slog.Warn(
				"legacy compatibility used",
				"legacy", usage.Legacy,
				"replacement", usage.Replacement,
				"removalVersion", compat.RemovalVersion,
			)
		}),
		store:            store,
		runner:           runner,
		hub:              hub,
		providers:        providerRegistry,
		codexCredentials: codexauth.NewStore(codexauth.DefaultStoreDir(cfg.Paths.HomeDir)),
		toolRegistry:     newCoreToolRegistry(),
	}
}

// lockAgentMutation serializes model and reasoning mutations for one agent.
// The lock entry is reference-counted so independent agents remain concurrent
// and completed agents do not accumulate entries indefinitely.
func (s *Server) lockAgentMutation(agentID string) func() {
	s.agentMutationLocksMu.Lock()
	if s.agentMutationLocks == nil {
		s.agentMutationLocks = make(map[string]*agentMutationLock)
	}
	lock := s.agentMutationLocks[agentID]
	if lock == nil {
		lock = &agentMutationLock{}
		s.agentMutationLocks[agentID] = lock
	}
	lock.refs++
	s.agentMutationLocksMu.Unlock()

	lock.mu.Lock()
	return func() {
		lock.mu.Unlock()
		s.agentMutationLocksMu.Lock()
		lock.refs--
		if lock.refs == 0 {
			delete(s.agentMutationLocks, agentID)
		}
		s.agentMutationLocksMu.Unlock()
	}
}

func newCoreToolRegistry() *tools.Registry {
	registry := tools.NewRegistry()
	tools.RegisterCore(registry)
	return registry
}

func (s *Server) SetToolRegistry(registry *tools.Registry) {
	if registry == nil {
		registry = newCoreToolRegistry()
	}
	s.toolRegistryMu.Lock()
	defer s.toolRegistryMu.Unlock()
	s.toolRegistry = registry
}

func (s *Server) toolRegistrySnapshot() *tools.Registry {
	s.toolRegistryMu.RLock()
	registry := s.toolRegistry
	s.toolRegistryMu.RUnlock()
	if registry != nil {
		return registry
	}

	registry = newCoreToolRegistry()
	s.toolRegistryMu.Lock()
	if s.toolRegistry == nil {
		s.toolRegistry = registry
	} else {
		registry = s.toolRegistry
	}
	s.toolRegistryMu.Unlock()
	return registry
}

func (s *Server) SetConfigPath(path string) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	s.configPath = path
}

func (s *Server) SetWebhookNotifier(notifier *WebhookNotifier) {
	s.notifier = notifier
}

func (s *Server) SetAutomationManager(manager *automation.Manager) {
	s.automation = manager
}

func (s *Server) SetConnectionService(service *integrations.ConnectionService) {
	s.connections = service
}

func (s *Server) SetPluginService(service PluginService) {
	s.plugins = service
}

func (s *Server) SetAuditRecorder(recorder audit.Recorder) {
	s.audit = recorder
}

func (s *Server) SetIntegrationHTTPClient(client *http.Client) {
	s.integrationClient = client
}

func (s *Server) SetDeviceAdapterFactory(factory func(context.Context, string) (devices.Adapter, error)) {
	s.deviceAdapterFactory = factory
}

func (s *Server) SetPreviewManager(manager *preview.Manager) {
	s.previewManager = manager
}

func (s *Server) warnLegacy(key, legacy, replacement, kind string) {
	if s.legacyWarnings == nil {
		return
	}
	s.legacyWarnings.Warn(compat.Usage{
		Key:         key,
		Legacy:      legacy,
		Replacement: replacement,
		Kind:        kind,
	})
}

func (s *Server) configSnapshot() config.Config {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.cfg
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(s.localRequestGuard)
	r.Use(s.projectAccessGuard)
	s.mountUI(r)

	r.Get("/api/health", s.health)
	r.Get("/api/auth/status", s.authStatus)
	r.Post("/api/auth/register", s.register)
	r.Post("/api/auth/login", s.login)
	r.Post("/api/auth/logout", s.logout)
	r.Get("/api/auth/me", s.me)
	r.Get("/api/users", s.listUsers)
	r.Get("/api/settings", s.settings)
	r.Get("/api/models", s.models)
	r.Get("/api/licenses", s.licenses)
	r.Get("/api/runtime/summary", s.runtimeSummary)
	r.Get("/api/storage/summary", s.storageSummary)
	r.Get("/api/usage/summary", s.usageSummary)
	r.Get("/api/navigation", s.navigation)
	r.Group(func(r chi.Router) {
		r.Use(s.sensitiveLocalTokenGuard)
		r.Post("/api/providers/test", s.testProviderConfigDraft)
		r.Put("/api/providers/{name}/config", s.updateProviderConfig)
		r.Patch("/api/providers/{name}", s.patchProviderConfig)
		r.Delete("/api/providers/{name}", s.deleteProviderConfig)
		r.Post("/api/providers/{name}/test", s.testProviderConfig)
		r.Get("/api/providers/oauth/codex/accounts", s.listCodexOAuthAccounts)
		r.Patch("/api/providers/oauth/codex/accounts/{id}", s.patchCodexOAuthAccount)
		r.Post("/api/providers/oauth/codex/accounts/{id}/refresh", s.refreshCodexOAuthAccount)
		r.Delete("/api/providers/oauth/codex/accounts/{id}", s.deleteCodexOAuthAccount)
		r.Post("/api/providers/oauth/codex/import", s.importCodexOAuthCredentials)
		r.Get("/api/providers/{name}/auth-files", s.listProviderAuthFiles)
		r.Post("/api/providers/{name}/auth-files/import", s.importProviderAuthFile)
		r.Get("/api/plugins", s.listPlugins)
		r.Post("/api/plugins/install", s.installPlugin)
		r.Get("/api/plugins/{id}", s.getPlugin)
		r.Post("/api/plugins/{id}/enable", s.enablePlugin)
		r.Post("/api/plugins/{id}/disable", s.disablePlugin)
		r.Post("/api/plugins/{id}/discover", s.discoverPlugin)
		r.Delete("/api/plugins/{id}", s.uninstallPlugin)
	})
	r.Route("/api/backends", func(r chi.Router) {
		r.Get("/", s.listBackends)
		r.Post("/", s.createBackend)
		r.Get("/{id}", s.getBackend)
		r.Patch("/{id}", s.updateBackend)
		r.Delete("/{id}", s.deleteBackend)
		r.Post("/{id}/activate", s.activateBackend)
		r.Get("/{id}/health", s.backendHealth)
	})
	r.Route("/api/memories", func(r chi.Router) {
		r.Get("/", s.listMemories)
		r.Post("/", s.createMemory)
		r.Get("/{id}", s.getMemory)
		r.Patch("/{id}", s.updateMemory)
		r.Delete("/{id}", s.deleteMemory)
	})
	r.Route("/api/skills", func(r chi.Router) {
		r.Get("/", s.listSkills)
		r.Post("/", s.createSkill)
		r.Post("/import/preview", s.previewSkillImport)
		r.Post("/import", s.importSkill)
		r.Get("/{id}", s.getSkill)
		r.Patch("/{id}", s.updateSkill)
		r.Delete("/{id}", s.deleteSkill)
	})
	r.Route("/api/v2/skills", func(r chi.Router) {
		r.Get("/", s.listSkillsV2)
		r.Post("/", s.createSkillV2)
		r.Post("/import/preview", s.previewSkillImport)
		r.Post("/import", s.importSkillV2)
		r.Get("/{id}", s.getSkillV2)
		r.Patch("/{id}", s.updateSkillV2)
		r.Delete("/{id}", s.deleteSkillV2)
		r.Get("/{id}/revisions", s.listSkillRevisionsV2)
		r.Get("/{id}/revisions/{revisionNo}", s.getSkillRevisionV2)
		r.Post("/{id}/restore", s.restoreSkillV2)
		r.Post("/{id}/revisions/{revisionNo}/restore", s.restoreSkillV2)
	})
	r.Route("/api/mcp/servers", func(r chi.Router) {
		r.Get("/", s.listMCPServers)
		r.Post("/", s.createMCPServer)
		r.Get("/{id}", s.getMCPServer)
		r.Patch("/{id}", s.updateMCPServer)
		r.Delete("/{id}", s.deleteMCPServer)
		r.Get("/{id}/tools", s.listMCPServerTools)
	})
	r.Route("/api/notifications", func(r chi.Router) {
		r.Get("/settings", s.getNotificationSettings)
		r.Put("/settings", s.updateNotificationSettings)
		r.Post("/test", s.testNotification)
		r.Get("/deliveries", s.listNotificationDeliveries)
		r.Post("/deliveries/{id}/retry", s.retryNotificationDelivery)
	})
	r.Route("/api/schedules", func(r chi.Router) {
		r.Get("/", s.listSchedules)
		r.Post("/", s.createSchedule)
		r.Patch("/{id}", s.updateSchedule)
		r.Delete("/{id}", s.deleteSchedule)
		r.Post("/{id}/run", s.runSchedule)
	})
	r.Route("/api/integrations/connections", func(r chi.Router) {
		r.Get("/", s.listIntegrationConnections)
		r.Post("/", s.createIntegrationConnection)
		r.Patch("/{id}", s.updateIntegrationConnection)
		r.Delete("/{id}", s.deleteIntegrationConnection)
		r.Post("/{id}/test", s.testIntegrationConnection)
	})
	r.Post("/api/channels/pairing-codes", s.createChannelPairingCode)
	r.Get("/api/channels/pairings", s.listChannelPairings)
	r.Post("/api/channels/pairings/{id}/revoke", s.revokeChannelPairing)
	r.Get("/api/audit/events", s.listAuditEvents)
	r.Get("/api/devices", s.listDevices)
	r.Post("/api/device-actions", s.createDeviceAction)
	r.Post("/api/device-actions/{id}/approve", s.approveDeviceAction)
	r.Post("/api/device-actions/{id}/deny", s.denyDeviceAction)
	r.Get("/api/monitoring/snapshot", s.monitoringSnapshot)

	r.Route("/api/workflow", func(r chi.Router) {
		r.Get("/preferences", s.getWorkflowPreferences)
		r.Put("/preferences", s.updateWorkflowPreferences)
		r.Get("/tool-permissions", s.listToolPermissionRules)
		r.Post("/tool-permissions", s.createToolPermissionRule)
		r.Patch("/tool-permissions/{id}", s.updateToolPermissionRule)
		r.Delete("/tool-permissions/{id}", s.deleteToolPermissionRule)
	})

	r.Route("/api/fs", func(r chi.Router) {
		r.Get("/browse", s.fsBrowse)
		r.Get("/directories", s.fsDirectories)
		r.Post("/native-directory", s.fsNativeDirectory)
		r.Get("/preview", s.fsPreview)
		r.Post("/mkdir", s.fsMkdir)
	})

	r.Route("/api/projects", func(r chi.Router) {
		r.Get("/", s.listProjects)
		r.Post("/", s.createProject)
		r.Get("/{id}", s.getProject)
		r.Get("/{id}/worklines", s.listProjectWorklines)
		r.Get("/{id}/chapters", s.listProjectWorklines)
	})
	r.Get("/api/worklines/{id}", s.getWorkline)
	r.Post("/api/worklines/{id}/fork", s.forkWorkline)
	r.Get("/api/worklines/{id}/merge-check", s.worklineMergeCheck)
	r.Post("/api/worklines/{id}/merge", s.worklineMerge)
	r.Get("/api/worklines/{id}/agents", s.listWorklineAgents)
	r.Get("/api/chapters/{id}", s.getWorkline)
	r.Post("/api/chapters/{id}/fork", s.forkWorkline)
	r.Get("/api/chapters/{id}/merge-check", s.worklineMergeCheck)
	r.Post("/api/chapters/{id}/merge", s.worklineMerge)
	r.Get("/api/chapters/{id}/narrators", s.listWorklineAgents)
	agentRoutes := func(r chi.Router) {
		r.Get("/{id}", s.getAgent)
		r.Get("/{id}/live-snapshot", s.getAgentLiveSnapshot)
		r.Patch("/{id}/cwd", s.updateAgentCWD)
		r.Patch("/{id}/model", s.updateAgentModel)
		r.Patch("/{id}/reasoning-effort", s.updateAgentReasoningEffort)
		r.Patch("/{id}/permission-mode", s.updateAgentPermissionMode)
		r.Post("/{id}/interrupt", s.interruptAgent)
		r.Get("/{id}/messages", s.listMessages)
		r.Post("/{id}/messages", s.postMessage)
		r.Get("/{id}/draft", s.getMessageDraft)
		r.Put("/{id}/draft", s.putMessageDraft)
		r.Delete("/{id}/draft", s.deleteMessageDraft)
		r.Post("/{id}/messages/{messageId}/corrections", s.createCorrection)
		r.Get("/{id}/messages/{messageId}/attachments/{attachmentId}", s.getMessageAttachment)
		r.Get("/{id}/runs", s.listRuns)
		r.Get("/{id}/runs/active", s.getActiveRunSummary)
		r.Get("/{id}/runs/{runId}", s.getRunSummary)
		r.Get("/{id}/runs/{runId}/rollback", s.rollbackRunPreview)
		r.Post("/{id}/runs/{runId}/rollback", s.rollbackRun)
		r.Get("/{id}/runs/{runId}/tool-calls", s.listRunToolCalls)
		r.Get("/{id}/tools", s.listTools)
		r.Post("/{id}/tool-calls", s.executeTool)
		r.Get("/{id}/tool-calls/pending", s.listPendingToolCalls)
		r.Post("/{id}/tool-calls/{toolUseId}/approval", s.approveToolCall)
		r.Get("/{id}/tool-calls/{toolUseId}", s.getToolCall)
		r.Get("/{id}/git/status", s.gitStatus)
		r.Get("/{id}/git/diff", s.gitDiff)
		r.Get("/{id}/git/log", s.gitLog)
		r.Post("/{id}/git/commit", s.gitCommit)
		r.Get("/{id}/workspace/tree", s.workspaceTree)
		r.Get("/{id}/workspace/file", s.workspaceFile)
		r.Put("/{id}/workspace/file", s.updateWorkspaceFile)
		r.Get("/{id}/preview/detect", s.detectPreview)
		r.Post("/{id}/preview/start", s.startPreview)
		r.Post("/{id}/preview/stop", s.stopPreview)
		r.Get("/{id}/preview/status", s.previewStatus)
		r.Get("/{id}/preview/logs", s.previewLogs)
	}
	r.Route("/api/agents", agentRoutes)
	r.Route("/api/narrators", agentRoutes)
	s.mountLearnedFeatureRoutes(r)
	s.MountUpdateRoutes(r)
	r.Get("/api/model-aggregates", s.listModelAggregates)
	r.Get("/api/model-aggregates/{name}", s.getModelAggregate)
	r.Put("/api/model-aggregates/{name}", s.putModelAggregate)
	r.Delete("/api/model-aggregates/{name}", s.deleteModelAggregate)
	r.Patch("/api/runtime/model-settings", s.updateRuntimeModelSettings)
	r.Patch("/api/agents/{id}/reasoning-effort", s.updateAgentReasoningEffort)
	r.Get("/api/client/identity", s.clientIdentity)
	r.Post("/api/client/identity/rotate", s.rotateClientIdentity)
	r.Get("/api/execution/devices", s.listExecutionDevices)
	r.Post("/api/execution/devices", s.registerRemoteExecutionDevice)
	r.Post("/api/execution/devices/{deviceId}/enable", s.enableExecutionDevice)
	r.Post("/api/execution/devices/{deviceId}/disable", s.disableExecutionDevice)
	r.Put("/api/projects/{projectId}/execution-devices/{deviceId}", s.setProjectExecutionDeviceGrant)
	r.Patch("/api/agents/{id}/execution-device", s.setAgentExecutionDevice)
	r.Get("/api/execution/tasks", s.listRemoteExecutionTasks)
	r.Post("/api/execution/tasks", s.createRemoteExecutionTask)
	r.Get("/api/execution/tasks/{taskId}", s.getRemoteExecutionTask)
	r.Get("/api/network/diagnostics", s.getNetworkDiagnostics)
	r.Post("/api/network/diagnostics/probe", s.runNetworkDiagnostic)
	r.Get("/api/v2/agents/{id}/live-snapshot", s.getAgentLiveSnapshot)
	r.Get("/api/v2/agents/{id}/stream-state", s.getAgentStreamState)
	r.Get("/api/v2/agents/{id}/skills/effective", s.listEffectiveSkillsV2)
	r.Get("/ws/agent", s.agentWS)
	r.Get("/ws/narrator", s.agentWS)
	r.Get("/ws/terminal", s.terminalWS)
	return r
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain exactly one JSON value")
		}
		return err
	}
	return nil
}

func statusFromError(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if db.IsNotFound(err) || errors.Is(err, http.ErrMissingFile) {
		return http.StatusNotFound
	}
	if db.IsConflict(err) {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}
