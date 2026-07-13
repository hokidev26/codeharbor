package server

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
	"autoto/internal/providers"
)

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": config.Version})
}

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	hasUsers, err := s.store.HasUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hasUsers": hasUsers, "registrationOpen": s.configSnapshot().Auth.RegistrationOpen})
}

type settingsProviderResponse struct {
	Name           string                      `json:"name"`
	Type           string                      `json:"type"`
	Profile        string                      `json:"profile,omitempty"`
	BaseURL        string                      `json:"baseUrl,omitempty"`
	Model          string                      `json:"model"`
	MaxTokens      int64                       `json:"maxTokens,omitempty"`
	Configured     bool                        `json:"configured"`
	APIKeyOptional bool                        `json:"apiKeyOptional,omitempty"`
	Capabilities   providers.Capabilities      `json:"capabilities"`
	Management     *providerManagementResponse `json:"management,omitempty"`
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	cfg := s.configSnapshot()
	summaries := cfg.Providers.Summaries()
	providerResponses := make([]settingsProviderResponse, 0, len(summaries))
	for _, summary := range summaries {
		metadata := s.providerSettingsMetadata(summary)
		providerResponses = append(providerResponses, settingsProviderResponse{
			Name: summary.Name, Type: summary.Type, Profile: metadata.Profile, BaseURL: summary.BaseURL, Model: summary.Model,
			MaxTokens: summary.MaxTokens, Configured: summary.Configured, APIKeyOptional: summary.APIKeyOptional,
			Capabilities: metadata.Capabilities, Management: metadata.Management,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"server":    cfg.Server,
		"paths":     cfg.Paths,
		"agent":     cfg.Agent,
		"providers": providerResponses,
		"version":   config.Version,
	})
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

type createProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	GitPath     string `json:"gitPath"`
	Model       string `json:"model"`
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cfg := s.configSnapshot()
	gitPath := cleanProjectPath(strings.TrimSpace(req.GitPath))
	if gitPath == "" {
		gitPath = filepath.Join(cfg.Paths.DefaultProjectDir, slugify(req.Name))
	}
	absGitPath, err := filepath.Abs(gitPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	gitPath = absGitPath
	if err := os.MkdirAll(gitPath, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = cfg.Agent.DefaultModel
	}
	permissionMode := s.safeDefaultPermissionModeForRequest(r, cfg.Agent.DefaultPermissionMode)
	project, workline, agent, err := s.store.CreateProject(r.Context(), req.Name, req.Description, gitPath, model, permissionMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project": project, "workline": workline, "agent": agent})
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.GetProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, project)
}

var slugCleanup = regexp.MustCompile(`[^a-z0-9_-]+`)

func cleanProjectPath(path string) string {
	if strings.HasPrefix(path, "Users"+string(filepath.Separator)) {
		return string(filepath.Separator) + path
	}
	return path
}

func slugify(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = slugCleanup.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "project"
	}
	return slug
}

func (s *Server) listProjectWorklines(w http.ResponseWriter, r *http.Request) {
	worklines, err := s.store.ListWorklinesByProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, worklines)
}

func (s *Server) getWorkline(w http.ResponseWriter, r *http.Request) {
	workline, err := s.store.GetWorkline(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "workline not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, workline)
}

func (s *Server) listWorklineAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := s.store.ListAgentsByWorkline(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agents)
}
