package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"autoto/internal/db"
)

type putMessageDraftRequest struct {
	ContentText *string `json:"contentText"`
	Text        *string `json:"text"`
	Version     *int64  `json:"version"`
}

func (s *Server) getMessageDraft(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	draft, err := s.store.GetMessageDraft(r.Context(), user.ID, chi.URLParam(r, "id"))
	if errors.Is(err, db.ErrConflict) {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "message draft not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) putMessageDraft(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req putMessageDraftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Version == nil {
		writeError(w, http.StatusBadRequest, "version is required")
		return
	}
	content := req.ContentText
	if content == nil {
		content = req.Text
	}
	if content == nil {
		writeError(w, http.StatusBadRequest, "contentText is required")
		return
	}
	draft, err := s.store.PutMessageDraft(r.Context(), db.MessageDraft{UserID: user.ID, AgentID: chi.URLParam(r, "id"), ContentText: *content}, *req.Version)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) deleteMessageDraft(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteMessageDraft(r.Context(), user.ID, chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type correctionRequest struct {
	Text              string   `json:"text"`
	KeepAttachmentIDs []string `json:"keepAttachmentIds"`
}

func (s *Server) createCorrection(w http.ResponseWriter, r *http.Request) {
	if s.runner == nil {
		writeError(w, http.StatusServiceUnavailable, "agent runner is not initialized")
		return
	}
	var text string
	var keepAttachmentIDs []string
	var attachments []db.Attachment
	var err error
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		text, keepAttachmentIDs, attachments, err = parseMultipartCorrection(w, r)
	} else {
		var req correctionRequest
		err = decodeJSON(r, &req)
		text, keepAttachmentIDs = req.Text, req.KeepAttachmentIDs
	}
	if err != nil {
		var uploadErr attachmentUploadError
		if errors.As(err, &uploadErr) {
			writeError(w, uploadErr.Status, uploadErr.Message)
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	createdBy := ""
	if user, ok, err := s.currentUser(r); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	} else if ok {
		createdBy = user.ID
	}
	if err := s.enforceRemotePermissionCap(r, chi.URLParam(r, "id")); err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	message, err := s.runner.SubmitCorrection(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "messageId"), text, createdBy, keepAttachmentIDs, attachments...)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, message)
}

func parseMultipartCorrection(w http.ResponseWriter, r *http.Request) (string, []string, []db.Attachment, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxMessageUploadBytes)
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	if err := r.ParseMultipartForm(multipartMemoryBytes); err != nil {
		return "", nil, nil, attachmentUploadError{Status: http.StatusBadRequest, Message: fmt.Sprintf("附件上传解析失败：%v", err)}
	}
	var keepAttachmentIDs []string
	if raw := strings.TrimSpace(r.FormValue("keepAttachmentIds")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &keepAttachmentIDs); err != nil {
			return "", nil, nil, errors.New("keepAttachmentIds must be a JSON array")
		}
	}
	files := multipartFiles(r.MultipartForm)
	attachments := make([]db.Attachment, 0, len(files))
	var total int64
	for _, header := range files {
		if header == nil {
			continue
		}
		if header.Size > maxAttachmentBytes {
			return "", nil, nil, attachmentUploadError{Status: http.StatusRequestEntityTooLarge, Message: fmt.Sprintf("%s 超过 10 MB 限制", sanitizeAttachmentFilename(header.Filename))}
		}
		total += header.Size
		if total > maxMessageUploadBytes {
			return "", nil, nil, attachmentUploadError{Status: http.StatusRequestEntityTooLarge, Message: "单条消息附件总大小超过 25 MB"}
		}
		attachment, err := buildAttachmentFromPart(header)
		if err != nil {
			return "", nil, nil, err
		}
		attachments = append(attachments, attachment)
	}
	text := strings.TrimSpace(r.FormValue("text"))
	if text == "" && len(keepAttachmentIDs) == 0 && len(attachments) == 0 {
		return "", nil, nil, attachmentUploadError{Status: http.StatusBadRequest, Message: "text, files, or keepAttachmentIds is required"}
	}
	return text, keepAttachmentIDs, attachments, nil
}
