package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"codeharbor/internal/db"
	"codeharbor/internal/tools"
)

func (s *Server) getNarrator(w http.ResponseWriter, r *http.Request) {
	narrator, err := s.store.GetNarrator(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "narrator not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrator)
}

type updateCWDRequest struct {
	CWD string `json:"cwd"`
}

func (s *Server) updateNarratorCWD(w http.ResponseWriter, r *http.Request) {
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
	narrator, err := s.store.UpdateNarratorCWD(r.Context(), chi.URLParam(r, "id"), req.CWD)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrator)
}

type updateModelRequest struct {
	Model string `json:"model"`
}

func (s *Server) updateNarratorModel(w http.ResponseWriter, r *http.Request) {
	var req updateModelRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Model == "" {
		writeError(w, http.StatusBadRequest, "model is required")
		return
	}
	narrator, err := s.store.UpdateNarratorModel(r.Context(), chi.URLParam(r, "id"), req.Model)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrator)
}

type updatePermissionModeRequest struct {
	PermissionMode string `json:"permissionMode"`
}

func (s *Server) updateNarratorPermissionMode(w http.ResponseWriter, r *http.Request) {
	var req updatePermissionModeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validPermissionMode(req.PermissionMode) {
		writeError(w, http.StatusBadRequest, "invalid permissionMode")
		return
	}
	narrator, err := s.store.UpdateNarratorPermissionMode(r.Context(), chi.URLParam(r, "id"), req.PermissionMode)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrator)
}

func validPermissionMode(mode string) bool {
	switch mode {
	case "readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk":
		return true
	default:
		return false
	}
}

func (s *Server) interruptNarrator(w http.ResponseWriter, r *http.Request) {
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
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Text == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	msg, err := s.runner.SubmitUserMessage(r.Context(), chi.URLParam(r, "id"), req.Text, req.CreatedBy)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	msg, err := s.runner.SubmitUserMessage(r.Context(), chi.URLParam(r, "id"), text, createdBy, attachments...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	result, err := s.runner.ExecuteTool(r.Context(), chi.URLParam(r, "id"), tools.Call{ID: req.ToolUseID, Name: req.ToolName, Input: req.Input})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"toolUseId": req.ToolUseID, "result": result})
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
