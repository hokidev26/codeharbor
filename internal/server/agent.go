package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	agentpkg "autoto/internal/agent"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

type agentLiveSnapshotResponse struct {
	Protocol            int                      `json:"protocol"`
	Agent               db.Agent                 `json:"agent"`
	Messages            []db.Message             `json:"messages"`
	PendingApprovals    []db.ToolCall            `json:"pendingApprovals"`
	LatestRun           *db.Run                  `json:"latestRun,omitempty"`
	Generations         db.PermissionGenerations `json:"generations"`
	ExecutionGeneration int64                    `json:"executionGeneration"`
	ExecutionsSince     []db.Run                 `json:"executionsSince,omitempty"`
	ExecutionsTruncated bool                     `json:"executionsTruncated,omitempty"`
	Spec                *db.SpecBoard            `json:"spec,omitempty"`
	ChildAgents         []db.Agent               `json:"childAgents,omitempty"`
	Stream              agentpkg.StreamWatermark `json:"stream"`
}

func (s *Server) getAgentLiveSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.hub == nil {
		writeError(w, http.StatusServiceUnavailable, "agent event hub is not initialized")
		return
	}
	if err := rejectUnknownQuery(r, "afterExecutionGeneration"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	agentID := chi.URLParam(r, "id")
	watermark := s.hub.Watermark(agentID)
	snapshot, err := s.store.ReadAgentLiveSnapshot(r.Context(), agentID)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	var executions []db.Run
	var truncated bool
	if raw := strings.TrimSpace(r.URL.Query().Get("afterExecutionGeneration")); raw != "" {
		after, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || after < 0 {
			writeError(w, http.StatusBadRequest, "invalid afterExecutionGeneration")
			return
		}
		executions, truncated, err = s.store.ListRunsAfterExecutionGeneration(r.Context(), agentID, after, 20)
		if err != nil {
			writeError(w, statusFromError(err), err.Error())
			return
		}
	}
	spec, err := s.store.GetSpecBoard(r.Context(), agentID)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	children, err := s.store.ListChildAgents(r.Context(), agentID)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agentLiveSnapshotResponse{
		Protocol:            agentpkg.ProtocolVersion,
		Agent:               snapshot.Agent,
		Messages:            snapshot.Messages,
		PendingApprovals:    snapshot.PendingApprovals,
		LatestRun:           snapshot.LatestRun,
		Generations:         snapshot.Generations,
		ExecutionGeneration: snapshot.Agent.ExecutionGeneration,
		ExecutionsSince:     executions,
		ExecutionsTruncated: truncated,
		Spec:                &spec,
		ChildAgents:         children,
		Stream:              watermark,
	})
}

func (s *Server) getAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := s.store.GetAgent(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agent)
}

type updateCWDRequest struct {
	CWD string `json:"cwd"`
}

func (s *Server) updateAgentCWD(w http.ResponseWriter, r *http.Request) {
	var req updateCWDRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CWD == "" {
		writeError(w, http.StatusBadRequest, "cwd is required")
		return
	}
	info, err := os.Stat(req.CWD)
	if err != nil {
		writeError(w, statusFromFSError(err), err.Error())
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "cwd must be a directory")
		return
	}
	agentID := chi.URLParam(r, "id")
	agent, err := s.store.UpdateAgentCWD(r.Context(), agentID, req.CWD)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidateAgentApprovals(agentID, "tool approval invalidated because the agent workspace changed")
	}
	writeJSON(w, http.StatusOK, agent)
}

type updateModelRequest struct {
	Model string `json:"model"`
}

func (s *Server) updateAgentModel(w http.ResponseWriter, r *http.Request) {
	var req updateModelRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		writeError(w, http.StatusBadRequest, "model is required")
		return
	}
	if s.store == nil {
		writeError(w, http.StatusInternalServerError, "agent store is unavailable")
		return
	}
	agentID := strings.TrimSpace(chi.URLParam(r, "id"))
	unlock := s.lockAgentMutation(agentID)
	defer unlock()

	current, err := s.store.GetAgent(r.Context(), agentID)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	// Persist the model and compatible effort in one SQL UPDATE. A model switch
	// must never leave an old concrete effort attached to a provider that rejects
	// it; auto is the safe fallback when the target cannot support it.
	effort := s.safeReasoningEffortForCapabilities(r.Context(), current.ReasoningEffort, s.capabilitiesForAgentModel(model))
	agent, err := s.store.UpdateAgentModel(r.Context(), agentID, model, effort)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, agent)
}

func (s *Server) capabilitiesForAgentModel(model string) providers.Capabilities {
	if s == nil || s.providers == nil {
		return providers.Capabilities{}
	}
	provider, _, err := s.providers.Resolve(model)
	if err != nil {
		return providers.Capabilities{}
	}
	return providers.CapabilitiesFor(provider)
}

func (s *Server) safeReasoningEffortForCapabilities(ctx context.Context, effort string, capabilities providers.Capabilities) string {
	effort = strings.ToLower(strings.TrimSpace(effort))
	effectiveEffort := effort
	if effectiveEffort == "" {
		// An empty override inherits the runtime default. Preserve that inheritance
		// only when the target can support its actual value; otherwise persist an
		// explicit auto so a model switch cannot inherit an unsupported default.
		effectiveEffort = "auto"
		if s != nil && s.store != nil {
			if settings, err := s.store.GetRuntimeSettings(ctx); err == nil {
				effectiveEffort = strings.ToLower(strings.TrimSpace(settings.DefaultReasoningEffort))
			}
		}
	}
	if capabilities.SupportsReasoningEffort(effectiveEffort) {
		return effort
	}
	return "auto"
}

type updatePermissionModeRequest struct {
	PermissionMode string `json:"permissionMode"`
}

func (s *Server) updateAgentPermissionMode(w http.ResponseWriter, r *http.Request) {
	var req updatePermissionModeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	permissionMode, ok, message := s.permissionModeAllowedForRequest(r, req.PermissionMode)
	if !ok {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	agentID := chi.URLParam(r, "id")
	agent, err := s.store.UpdateAgentPermissionMode(r.Context(), agentID, permissionMode)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if s.runner != nil {
		s.runner.InvalidateAgentApprovals(agentID, "tool approval invalidated because the permission mode changed")
	}
	writeJSON(w, http.StatusOK, agent)
}

func validPermissionMode(mode string) bool {
	switch mode {
	case "readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk":
		return true
	default:
		return false
	}
}

func (s *Server) interruptAgent(w http.ResponseWriter, r *http.Request) {
	if s.runner == nil {
		writeError(w, http.StatusServiceUnavailable, "agent runner is not initialized")
		return
	}
	interrupted, err := s.runner.Interrupt(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"interrupted": interrupted})
}

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request) {
	messages, err := s.store.ListMessages(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	runs, err := s.store.ListRuns(r.Context(), chi.URLParam(r, "id"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) getRunSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := s.store.RunSummary(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "runId"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "run not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) listRunToolCalls(w http.ResponseWriter, r *http.Request) {
	calls, err := s.store.ListToolCallsByRun(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "runId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, calls)
}

func (s *Server) listPendingToolCalls(w http.ResponseWriter, r *http.Request) {
	calls, err := s.store.ListPendingToolCalls(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, calls)
}

type postMessageRequest struct {
	Text      string `json:"text"`
	CreatedBy string `json:"createdBy"`
}

func (s *Server) postMessage(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		s.postMultipartMessage(w, r)
		return
	}
	var req postMessageRequest
	if err := decodeLimitedJSON(w, r, &req, 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateAPIText("text", req.Text, 512<<10, true, true); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateAPIText("createdBy", req.CreatedBy, 200, false, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	agentID := chi.URLParam(r, "id")
	if goal, ok := parseGoalCommand(req.Text); ok {
		s.createGoalResponse(w, r, agentID, goal)
		return
	}
	if s.runner == nil {
		writeError(w, http.StatusServiceUnavailable, "agent runner is not initialized")
		return
	}
	if err := s.enforceRemotePermissionCap(r, agentID); err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	msg, err := s.runner.SubmitUserMessage(r.Context(), agentID, req.Text, req.CreatedBy)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, msg)
}

func (s *Server) postMultipartMessage(w http.ResponseWriter, r *http.Request) {
	text, createdBy, attachments, err := parseMultipartAttachments(w, r)
	if err != nil {
		var uploadErr attachmentUploadError
		if errors.As(err, &uploadErr) {
			writeError(w, uploadErr.Status, uploadErr.Message)
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.enforceRemotePermissionCap(r, chi.URLParam(r, "id")); err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	msg, err := s.runner.SubmitUserMessage(r.Context(), chi.URLParam(r, "id"), text, createdBy, attachments...)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, msg)
}

func (s *Server) getMessageAttachment(w http.ResponseWriter, r *http.Request) {
	attachment, err := s.store.GetAttachment(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "messageId"), chi.URLParam(r, "attachmentId"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "attachment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	contentType := attachment.MIMEType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	disposition := "attachment"
	if attachment.Kind == "image" || attachment.Kind == "pdf" || strings.HasPrefix(contentType, "text/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(attachment.Data)), 10))
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": attachment.Filename}))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(attachment.Data)
}

func (s *Server) listTools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.runner.ListTools())
}

type executeToolRequest struct {
	ToolUseID string          `json:"toolUseId"`
	ToolName  string          `json:"toolName"`
	Input     json.RawMessage `json:"input"`
}

func (s *Server) executeTool(w http.ResponseWriter, r *http.Request) {
	var req executeToolRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ToolName == "" {
		writeError(w, http.StatusBadRequest, "toolName is required")
		return
	}
	if req.ToolUseID == "" {
		req.ToolUseID = db.NewID()
	}
	if len(req.Input) == 0 {
		req.Input = json.RawMessage(`{}`)
	}
	if err := s.enforceRemotePermissionCap(r, chi.URLParam(r, "id")); err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	result, err := s.runner.ExecuteTool(r.Context(), chi.URLParam(r, "id"), tools.Call{ID: req.ToolUseID, Name: req.ToolName, Input: req.Input})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"toolUseId": req.ToolUseID, "result": result})
}

type approveToolCallRequest struct {
	Decision             string `json:"decision"`
	Reason               string `json:"reason"`
	PermissionGeneration int64  `json:"permissionGeneration"`
	PolicyGeneration     int64  `json:"policyGeneration"`
}

func (s *Server) approveToolCall(w http.ResponseWriter, r *http.Request) {
	if s.runner == nil {
		writeError(w, http.StatusServiceUnavailable, "agent runner is not initialized")
		return
	}
	var req approveToolCallRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	accepted, err := s.runner.ApproveToolCall(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "toolUseId"), agentpkg.ToolApprovalDecision{Decision: req.Decision, Reason: req.Reason, DecidedBy: "user", PermissionGeneration: req.PermissionGeneration, PolicyGeneration: req.PolicyGeneration})
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if !accepted {
		writeError(w, http.StatusNotFound, "pending tool approval not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"toolUseId": chi.URLParam(r, "toolUseId"), "decision": req.Decision, "accepted": true})
}

func (s *Server) getToolCall(w http.ResponseWriter, r *http.Request) {
	call, err := s.store.GetToolCallByUseID(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "toolUseId"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "tool call not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, call)
}
