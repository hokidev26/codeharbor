package server

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"autoto/internal/db"
)

type createAgentRequest struct {
	WorklineID     *string `json:"worklineId"`
	ParentAgentID  string  `json:"parentAgentId,omitempty"`
	Title          string  `json:"title"`
	Model          string  `json:"model"`
	PermissionMode string  `json:"permissionMode"`
	CWD            string  `json:"cwd"`
}

func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r, "limit"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	limit, err := queryInt(r, "limit", 200, 1, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	agents, err := s.store.ListAgents(r.Context(), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, agents)
}

func (s *Server) createAgent(w http.ResponseWriter, r *http.Request) {
	var req createAgentRequest
	if err := decodeLimitedJSON(w, r, &req, maxAgentJSONBody); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	worklineID := ""
	if req.WorklineID != nil {
		worklineID = strings.TrimSpace(*req.WorklineID)
	}
	parentAgentID := strings.TrimSpace(req.ParentAgentID)
	title := strings.TrimSpace(req.Title)
	model := strings.TrimSpace(req.Model)
	permissionMode := strings.TrimSpace(req.PermissionMode)
	cwd := strings.TrimSpace(req.CWD)
	for _, field := range []struct {
		name     string
		value    string
		max      int
		required bool
	}{
		{"worklineId", worklineID, 128, false}, {"parentAgentId", parentAgentID, 128, false},
		{"title", title, 120, true}, {"model", model, 256, true}, {"cwd", cwd, 4096, true},
	} {
		if err := validateAPIText(field.name, field.value, field.max, field.required, false); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	permissionMode, ok, message := s.permissionModeAllowedForRequest(r, permissionMode)
	if !ok {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	if worklineID != "" {
		if _, err := s.store.GetWorkline(r.Context(), worklineID); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	agentType := "primary"
	if parentAgentID != "" {
		if _, err := s.store.GetAgent(r.Context(), parentAgentID); err != nil {
			writeStoreError(w, err)
			return
		}
		agentType = "subagent"
	}
	info, err := os.Stat(cwd)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "cwd must be a directory")
		return
	}
	created, err := s.store.CreateAgent(r.Context(), db.Agent{
		WorklineID: worklineID, ParentAgentID: parentAgentID, Type: agentType,
		Title: title, Model: model, PermissionMode: permissionMode, Status: "idle", CWD: cwd,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) listAgentChildren(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	parentAgentID := strings.TrimSpace(chi.URLParam(r, "id"))
	if err := validateAPIIdentifier("agent id", parentAgentID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.store.GetAgent(r.Context(), parentAgentID); err != nil {
		writeStoreError(w, err)
		return
	}
	children, err := s.store.ListChildAgents(r.Context(), parentAgentID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, children)
}
