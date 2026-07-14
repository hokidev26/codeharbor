package server

import (
	"net/http"
	"strings"
)

type projectAccessTarget struct {
	kind string
	id   string
}

const (
	projectAccessCollection = "collection"
	projectAccessProject    = "project"
	projectAccessWorkline   = "workline"
	projectAccessAgent      = "agent"
)

// projectAccessGuard leaves a fresh local installation unchanged. Once at least
// one user exists, it requires a valid session for every project-scoped route
// and hides inaccessible resources behind a 404 response.
func (s *Server) projectAccessGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, scoped := projectAccessTargetForRequest(r)
		if !scoped || s.store == nil {
			next.ServeHTTP(w, r)
			return
		}
		hasUsers, err := s.store.HasUsers(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !hasUsers {
			next.ServeHTTP(w, r)
			return
		}
		user, ok, err := s.currentUser(r)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusUnauthorized, "login required")
			return
		}
		if target.kind == projectAccessCollection {
			next.ServeHTTP(w, r)
			return
		}

		var allowed bool
		switch target.kind {
		case projectAccessProject:
			allowed, err = s.store.CanAccessProject(r.Context(), user.ID, target.id)
		case projectAccessWorkline:
			allowed, err = s.store.CanAccessWorkline(r.Context(), user.ID, target.id)
		case projectAccessAgent:
			allowed, err = s.store.CanAccessAgent(r.Context(), user.ID, target.id)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !allowed {
			writeError(w, http.StatusNotFound, "resource not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func projectAccessTargetForRequest(r *http.Request) (projectAccessTarget, bool) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 {
		return projectAccessTarget{}, false
	}
	if parts[0] == "ws" && (parts[1] == "agent" || parts[1] == "narrator" || parts[1] == "terminal") {
		agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
		if agentID == "" && parts[1] != "terminal" {
			// Keep existing agent/narrator websocket clients working while moving
			// new callers to the explicit agentId query parameter.
			agentID = strings.TrimSpace(r.URL.Query().Get("id"))
		}
		return projectAccessTarget{kind: projectAccessAgent, id: agentID}, true
	}
	if parts[0] != "api" {
		return projectAccessTarget{}, false
	}
	switch parts[1] {
	case "projects":
		if len(parts) == 2 {
			return projectAccessTarget{kind: projectAccessCollection}, true
		}
		return projectAccessTarget{kind: projectAccessProject, id: parts[2]}, true
	case "worklines", "chapters":
		if len(parts) >= 3 {
			return projectAccessTarget{kind: projectAccessWorkline, id: parts[2]}, true
		}
	case "agents", "narrators":
		if len(parts) >= 3 {
			return projectAccessTarget{kind: projectAccessAgent, id: parts[2]}, true
		}
	case "v2":
		if len(parts) >= 4 && (parts[2] == "agents" || parts[2] == "narrators") {
			return projectAccessTarget{kind: projectAccessAgent, id: parts[3]}, true
		}
	}
	return projectAccessTarget{}, false
}

func (s *Server) requireAgentAccess(w http.ResponseWriter, r *http.Request, agentID string) bool {
	if s.store == nil {
		return true
	}
	hasUsers, err := s.store.HasUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !hasUsers {
		return true
	}
	user, ok, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "login required")
		return false
	}
	allowed, err := s.store.CanAccessAgent(r.Context(), user.ID, agentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "resource not found")
		return false
	}
	return true
}
