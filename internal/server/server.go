package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
)

type Server struct {
	cfg       config.Config
	store     *db.Store
	runner    *agent.Runner
	hub       *agent.Hub
	providers *providers.Registry
}

func New(cfg config.Config, store *db.Store, runner *agent.Runner, hub *agent.Hub, providerRegistries ...*providers.Registry) *Server {
	var providerRegistry *providers.Registry
	if len(providerRegistries) > 0 {
		providerRegistry = providerRegistries[0]
	}
	return &Server{cfg: cfg, store: store, runner: runner, hub: hub, providers: providerRegistry}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	s.mountUI(r)

	r.Get("/api/health", s.health)
	r.Get("/api/auth/status", s.authStatus)
	r.Get("/api/settings", s.settings)
	r.Get("/api/models", s.models)
	r.Get("/api/licenses", s.licenses)
	r.Route("/api/backends", func(r chi.Router) {
		r.Get("/", s.listBackends)
		r.Post("/", s.createBackend)
		r.Get("/{id}", s.getBackend)
		r.Patch("/{id}", s.updateBackend)
		r.Delete("/{id}", s.deleteBackend)
		r.Post("/{id}/activate", s.activateBackend)
		r.Get("/{id}/health", s.backendHealth)
	})

	r.Route("/api/fs", func(r chi.Router) {
		r.Get("/browse", s.fsBrowse)
		r.Get("/directories", s.fsDirectories)
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
	r.Get("/api/chapters/{id}/narrators", s.listChapterNarrators)
	r.Route("/api/narrators", func(r chi.Router) {
		r.Get("/{id}", s.getNarrator)
		r.Patch("/{id}/cwd", s.updateNarratorCWD)
		r.Patch("/{id}/model", s.updateNarratorModel)
		r.Patch("/{id}/permission-mode", s.updateNarratorPermissionMode)
		r.Get("/{id}/messages", s.listMessages)
		r.Post("/{id}/messages", s.postMessage)
		r.Get("/{id}/tools", s.listTools)
		r.Post("/{id}/tool-calls", s.executeTool)
		r.Get("/{id}/tool-calls/{toolUseId}", s.getToolCall)
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
