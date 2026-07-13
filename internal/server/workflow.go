package server

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"autoto/internal/db"
	"autoto/internal/tools"
)

const (
	maxToolPermissionDescriptionBytes = 2000
	maxToolPermissionPriority         = 10000
)

type workflowPreferencesRequest struct {
	RequireConfirmationForExec   *bool `json:"requireConfirmationForExec"`
	RequireConfirmationForWrites *bool `json:"requireConfirmationForWrites"`
	AllowReadOnlyByDefault       *bool `json:"allowReadOnlyByDefault"`
}

type toolPermissionRuleRequest struct {
	Mode        *string `json:"mode"`
	ToolName    *string `json:"toolName"`
	Risk        *string `json:"risk"`
	Decision    *string `json:"decision"`
	Priority    *int    `json:"priority"`
	Enabled     *bool   `json:"enabled"`
	Description *string `json:"description"`
}

func (s *Server) getWorkflowPreferences(w http.ResponseWriter, r *http.Request) {
	prefs, err := s.store.GetWorkflowPreferences(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) updateWorkflowPreferences(w http.ResponseWriter, r *http.Request) {
	var req workflowPreferencesRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.RequireConfirmationForExec == nil || req.RequireConfirmationForWrites == nil || req.AllowReadOnlyByDefault == nil {
		writeError(w, http.StatusBadRequest, "all workflow preference fields are required")
		return
	}
	prefs, err := s.store.UpdateWorkflowPreferences(r.Context(), db.WorkflowPreferences{RequireConfirmationForExec: *req.RequireConfirmationForExec, RequireConfirmationForWrites: *req.RequireConfirmationForWrites, AllowReadOnlyByDefault: *req.AllowReadOnlyByDefault})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidatePolicyApprovals("tool approval invalidated because workflow preferences changed")
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) listToolPermissionRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.store.ListToolPermissionRules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) createToolPermissionRule(w http.ResponseWriter, r *http.Request) {
	var req toolPermissionRuleRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := s.ruleFromRequest(req, db.ToolPermissionRule{Mode: "*", ToolName: "*", Risk: "*", Enabled: true})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	created, err := s.store.CreateToolPermissionRule(r.Context(), rule)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidatePolicyApprovals("tool approval invalidated because a permission rule was created")
	}
	logToolPermissionRuleChange("created", created)
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateToolPermissionRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing, err := s.store.GetToolPermissionRule(r.Context(), id)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	var req toolPermissionRuleRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rule, err := s.ruleFromRequest(req, existing)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.store.UpdateToolPermissionRule(r.Context(), rule)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidatePolicyApprovals("tool approval invalidated because a permission rule changed")
	}
	logToolPermissionRuleChange("updated", updated)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteToolPermissionRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteToolPermissionRule(r.Context(), id); err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidatePolicyApprovals("tool approval invalidated because a permission rule was deleted")
	}
	slog.Info("tool permission rule deleted", "ruleId", id)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) ruleFromRequest(req toolPermissionRuleRequest, base db.ToolPermissionRule) (db.ToolPermissionRule, error) {
	if req.Mode != nil {
		base.Mode = strings.TrimSpace(*req.Mode)
	}
	if req.ToolName != nil {
		base.ToolName = strings.TrimSpace(*req.ToolName)
	}
	if req.Risk != nil {
		base.Risk = strings.TrimSpace(*req.Risk)
	}
	if req.Decision != nil {
		base.Decision = strings.TrimSpace(*req.Decision)
	}
	if req.Priority != nil {
		base.Priority = *req.Priority
	}
	if req.Enabled != nil {
		base.Enabled = *req.Enabled
	}
	if req.Description != nil {
		base.Description = strings.TrimSpace(*req.Description)
	}
	if base.Mode == "" {
		base.Mode = "*"
	}
	if base.ToolName == "" {
		base.ToolName = "*"
	}
	if base.Risk == "" {
		base.Risk = "*"
	}
	if err := validateToolPermissionRule(base, s.toolRegistrySnapshot()); err != nil {
		return db.ToolPermissionRule{}, err
	}
	return base, nil
}

func logToolPermissionRuleChange(action string, rule db.ToolPermissionRule) {
	slog.Info("tool permission rule "+action,
		"ruleId", rule.ID,
		"mode", rule.Mode,
		"toolName", rule.ToolName,
		"risk", rule.Risk,
		"decision", rule.Decision,
		"priority", rule.Priority,
		"enabled", rule.Enabled,
	)
}

func validateToolPermissionRule(rule db.ToolPermissionRule, registry *tools.Registry) error {
	if !validRuleMode(rule.Mode) {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "invalid tool permission mode"}
	}
	if !validRuleToolName(rule.ToolName, registry) {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "invalid tool permission tool name"}
	}
	if !validRuleRisk(rule.Risk) {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "invalid tool permission risk"}
	}
	if !validRuleDecision(rule.Decision) {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "invalid tool permission decision"}
	}
	if rule.Decision == "allow" && (rule.Risk == string(tools.RiskDanger) || rule.Risk == "*") {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "allow rules cannot target danger or wildcard risk"}
	}
	if rule.Priority < -maxToolPermissionPriority || rule.Priority > maxToolPermissionPriority {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "tool permission priority is out of range"}
	}
	if len(rule.Description) > maxToolPermissionDescriptionBytes {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "tool permission description is too long"}
	}
	return nil
}

func validRuleMode(mode string) bool {
	return mode == "*" || validPermissionMode(mode)
}

func validRuleToolName(name string, registry *tools.Registry) bool {
	if name == "*" {
		return true
	}
	if registry == nil {
		return false
	}
	_, ok := registry.Get(name)
	return ok
}

func validRuleRisk(risk string) bool {
	switch risk {
	case "*", string(tools.RiskRead), string(tools.RiskWrite), string(tools.RiskExec), string(tools.RiskDanger):
		return true
	default:
		return false
	}
}

func validRuleDecision(decision string) bool {
	switch decision {
	case "allow", "ask", "deny":
		return true
	default:
		return false
	}
}
