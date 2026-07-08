package server

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"codeharbor/internal/config"
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

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	cfg := s.configSnapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"server":    cfg.Server,
		"paths":     cfg.Paths,
		"agent":     cfg.Agent,
		"providers": cfg.Providers.Summaries(),
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
	project, chapter, narrator, err := s.store.CreateProject(r.Context(), req.Name, req.Description, gitPath, model, permissionMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project": project, "chapter": chapter, "narrator": narrator})
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

func (s *Server) listProjectChapters(w http.ResponseWriter, r *http.Request) {
	chapters, err := s.store.ListChaptersByProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, chapters)
}

func (s *Server) getChapter(w http.ResponseWriter, r *http.Request) {
	chapter, err := s.store.GetChapter(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "chapter not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, chapter)
}

func (s *Server) listChapterNarrators(w http.ResponseWriter, r *http.Request) {
	narrators, err := s.store.ListNarratorsByChapter(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrators)
}
