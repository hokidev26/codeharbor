package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
)

type Server struct {
	cfg                 config.Config
	cfgMu               sync.RWMutex
	configPath          string
	startedAt           time.Time
	clock               func() time.Time
	localToken          string
	remoteAccessToken   string
	remoteAccessFailure map[string]remoteAccessFailure
	remoteAccessMu      sync.Mutex
	store               *db.Store
	runner              *agent.Runner
	hub                 *agent.Hub
	providers           *providers.Registry
}

func New(cfg config.Config, store *db.Store, runner *agent.Runner, hub *agent.Hub, providerRegistries ...*providers.Registry) *Server {
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
		store:               store,
		runner:              runner,
		hub:                 hub,
		providers:           providerRegistry,
	}
}

func (s *Server) SetConfigPath(path string) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	s.configPath = path
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
	s.mountUI(r)

	r.Get("/api/health", s.health)
	r.Get("/api/auth/status", s.authStatus)
	r.Get("/api/settings", s.settings)
	r.Get("/api/models", s.models)
	r.Get("/api/licenses", s.licenses)
	r.Get("/api/runtime/summary", s.runtimeSummary)
	r.Get("/api/storage/summary", s.storageSummary)
	r.Get("/api/usage/summary", s.usageSummary)
	r.Put("/api/providers/{name}/config", s.updateProviderConfig)
	r.Route("/api/providers/cliproxyapi", func(r chi.Router) {
		r.Get("/auth-files", s.listCLIProxyAPIAuthFiles)
		r.Post("/auth-files/import", s.importCLIProxyAPIAuthFile)
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
	r.Route("/api/mcp/servers", func(r chi.Router) {
		r.Get("/", s.listMCPServers)
		r.Post("/", s.createMCPServer)
		r.Get("/{id}", s.getMCPServer)
		r.Patch("/{id}", s.updateMCPServer)
		r.Delete("/{id}", s.deleteMCPServer)
		r.Get("/{id}/tools", s.listMCPServerTools)
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
		r.Get("/{id}/chapters", s.listProjectChapters)
	})
	r.Get("/api/chapters/{id}", s.getChapter)
	r.Post("/api/chapters/{id}/fork", s.forkChapter)
	r.Get("/api/chapters/{id}/merge-check", s.chapterMergeCheck)
	r.Post("/api/chapters/{id}/merge", s.chapterMerge)
	r.Get("/api/chapters/{id}/narrators", s.listChapterNarrators)
	r.Route("/api/narrators", func(r chi.Router) {
		r.Get("/{id}", s.getNarrator)
		r.Patch("/{id}/cwd", s.updateNarratorCWD)
		r.Patch("/{id}/model", s.updateNarratorModel)
		r.Patch("/{id}/permission-mode", s.updateNarratorPermissionMode)
		r.Post("/{id}/interrupt", s.interruptNarrator)
		r.Get("/{id}/messages", s.listMessages)
		r.Post("/{id}/messages", s.postMessage)
		r.Get("/{id}/messages/{messageId}/attachments/{attachmentId}", s.getMessageAttachment)
		r.Get("/{id}/runs", s.listRuns)
		r.Get("/{id}/runs/{runId}", s.getRunSummary)
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
	})
	r.Get("/ws/narrator", s.narratorWS)
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
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

func statusFromError(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if db.IsNotFound(err) || errors.Is(err, http.ErrMissingFile) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}
