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
	writeJSON(w, http.StatusOK, map[string]any{"hasUsers": hasUsers, "registrationOpen": s.cfg.Auth.RegistrationOpen})
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"server":    s.cfg.Server,
		"paths":     s.cfg.Paths,
		"agent":     s.cfg.Agent,
		"providers": s.cfg.Providers.Summaries(),
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
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	gitPath := strings.TrimSpace(req.GitPath)
	if gitPath == "" {
		gitPath = filepath.Join(s.cfg.Paths.DefaultProjectDir, slugify(req.Name))
	}
	if err := os.MkdirAll(gitPath, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	project, chapter, narrator, err := s.store.CreateProject(r.Context(), req.Name, req.Description, gitPath, s.cfg.Agent.DefaultModel, s.cfg.Agent.DefaultPermissionMode)
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
