package server

import (
	"encoding/json"
	"net/http"
	"strings"

	updatepkg "autoto/internal/update"
)

// ShellLifecycleHost is optional desktop-only lifecycle control (autostart).
// Browser and remote sessions never receive a non-nil host.
type ShellLifecycleHost interface {
	AutostartStatus() (enabled bool, strategy, path string, err error)
	AutostartEnable() error
	AutostartDisable() error
	// HandleDeepLink is informational for the shell (focus + navigate). HTTP
	// callers only forward a validated autoto:// URL; they cannot run host commands.
	NotifyDeepLink(raw string) error
}

// ShellUpdateHost stages a local binary after user confirmation. It must not
// download from the network or apply the replace inside the request path.
type ShellUpdateHost interface {
	// StageLocalUpdate copies sourcePath into the home updates/staged dir.
	StageLocalUpdate(sourcePath, version, sha256 string) (updatepkg.PendingReplace, error)
	PendingUpdate() (updatepkg.PendingReplace, bool, error)
	ClearPendingUpdate() error
}

func (s *Server) SetShellLifecycleHost(host ShellLifecycleHost) {
	if s == nil {
		return
	}
	s.shellDialogMu.Lock()
	s.shellLifecycleHost = host
	s.shellDialogMu.Unlock()
}

func (s *Server) SetShellUpdateHost(host ShellUpdateHost) {
	if s == nil {
		return
	}
	s.shellDialogMu.Lock()
	s.shellUpdateHost = host
	s.shellDialogMu.Unlock()
}

func (s *Server) shellLifecycle() ShellLifecycleHost {
	if s == nil {
		return nil
	}
	s.shellDialogMu.RLock()
	defer s.shellDialogMu.RUnlock()
	return s.shellLifecycleHost
}

func (s *Server) shellUpdate() ShellUpdateHost {
	if s == nil {
		return nil
	}
	s.shellDialogMu.RLock()
	defer s.shellDialogMu.RUnlock()
	return s.shellUpdateHost
}

func (s *Server) mountDesktopShellExtraRoutes(r interface {
	Get(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
	Delete(pattern string, h http.HandlerFunc)
}) {
	r.Get("/api/desktop/autostart", s.desktopAutostartGet)
	r.Post("/api/desktop/autostart", s.desktopAutostartPost)
	r.Delete("/api/desktop/autostart", s.desktopAutostartDelete)
	r.Post("/api/desktop/deep-link", s.desktopDeepLinkPost)
	r.Get("/api/desktop/update/pending", s.desktopUpdatePendingGet)
	r.Post("/api/desktop/update/stage", s.desktopUpdateStagePost)
	r.Delete("/api/desktop/update/pending", s.desktopUpdatePendingDelete)
}

func (s *Server) requireShellLoopback(w http.ResponseWriter, r *http.Request) bool {
	if s.remoteAccessGateRequired(r) {
		writeError(w, http.StatusForbidden, "desktop shell APIs require local access")
		return false
	}
	if !trustedLoopbackPeer(r) {
		writeError(w, http.StatusForbidden, "desktop shell APIs require loopback peer")
		return false
	}
	if isBrowserInitiated(r) && !s.validHeaderToken(r) {
		writeError(w, http.StatusUnauthorized, "missing or invalid local API token")
		return false
	}
	return true
}

func (s *Server) desktopAutostartGet(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellLifecycle()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop autostart unavailable")
		return
	}
	enabled, strategy, path, err := host.AutostartStatus()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"enabled":  enabled,
		"strategy": strategy,
		"path":     path,
	})
}

func (s *Server) desktopAutostartPost(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellLifecycle()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop autostart unavailable")
		return
	}
	if err := host.AutostartEnable(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	enabled, strategy, path, _ := host.AutostartStatus()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enabled": enabled, "strategy": strategy, "path": path})
}

func (s *Server) desktopAutostartDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellLifecycle()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop autostart unavailable")
		return
	}
	if err := host.AutostartDisable(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enabled": false})
}

type deepLinkRequest struct {
	URL string `json:"url"`
}

func (s *Server) desktopDeepLinkPost(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellLifecycle()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop deep link host unavailable")
		return
	}
	var req deepLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid deep link request")
		return
	}
	raw := strings.TrimSpace(req.URL)
	if raw == "" || !strings.HasPrefix(strings.ToLower(raw), "autoto:") {
		writeError(w, http.StatusBadRequest, "url must be an autoto:// deep link")
		return
	}
	if err := host.NotifyDeepLink(raw); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type stageUpdateRequest struct {
	SourcePath string `json:"sourcePath"`
	Version    string `json:"version"`
	SHA256     string `json:"sha256"`
}

func (s *Server) desktopUpdatePendingGet(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellUpdate()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop update host unavailable")
		return
	}
	pending, ok, err := host.PendingUpdate()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pending": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"pending": true,
		"version": pending.Version,
		"path":    pending.StagedPath,
		"sha256":  pending.SHA256,
	})
}

func (s *Server) desktopUpdateStagePost(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellUpdate()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop update host unavailable")
		return
	}
	var req stageUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid stage request")
		return
	}
	pending, err := host.StageLocalUpdate(req.SourcePath, req.Version, req.SHA256)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"pending": true,
		"version": pending.Version,
		"path":    pending.StagedPath,
		"sha256":  pending.SHA256,
		// Apply requires an explicit host-side restart/replace helper.
		"apply": "manual_restart",
		"note":  "Staged only. Remote sessions cannot apply. Restart the desktop shell on the host to finish.",
	})
}

func (s *Server) desktopUpdatePendingDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireShellLoopback(w, r) {
		return
	}
	host := s.shellUpdate()
	if host == nil {
		writeError(w, http.StatusNotFound, "desktop update host unavailable")
		return
	}
	if err := host.ClearPendingUpdate(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pending": false})
}
