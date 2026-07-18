package server

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/oauthapp"

	"github.com/go-chi/chi/v5"
)

const (
	oauthAppSessionCookieName = "autoto_oauth_app_session"
	oauthAppLoginCookieName   = "autoto_oauth_app_login"
	oauthAppCallbackPath      = "/app/auth/callback"
	oauthAppMaxMessageRunes   = 12000
	oauthAppDiscoveryRetry    = 30 * time.Second

	oauthAppScopeProfileRead       = "profile:read"
	oauthAppScopeProjectsRead      = "projects:read"
	oauthAppScopeAgentsRead        = "agents:read"
	oauthAppScopeMessagesRead      = "messages:read"
	oauthAppScopeReadOnlyTaskWrite = "tasks:submit:read_only"
)

var errOAuthAppDisabled = errors.New("OAuth app OIDC login is disabled")

type oauthAppRuntime struct {
	key         string
	party       *oauthapp.RelyingParty
	lastErr     error
	lastAttempt time.Time
}

type oauthAppRequestConfig struct {
	OAuthApp         config.OAuthAppConfig
	RegistrationOpen bool
}

type oauthAppPrincipal struct {
	Session  db.OAuthAppSession
	User     db.User
	Identity db.OAuthAppIdentity
}

type oauthAppUserView struct {
	ID          string `json:"id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

type oauthAppCapabilities struct {
	ReadOnlyTaskSubmission bool   `json:"readOnlyTaskSubmission"`
	MaxPermissionMode      string `json:"maxPermissionMode"`
}

type oauthAppSessionView struct {
	Authenticated bool                 `json:"authenticated"`
	User          *oauthAppUserView    `json:"user,omitempty"`
	Capabilities  oauthAppCapabilities `json:"capabilities"`
}

type oauthAppProjectView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status"`
	Pinned      bool   `json:"pinned"`
	Archived    bool   `json:"archived"`
}

type oauthAppAgentView struct {
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	WorklineID string `json:"worklineId"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Pinned     bool   `json:"pinned"`
	Archived   bool   `json:"archived"`
}

type oauthAppMessageView struct {
	ID              string `json:"id"`
	Role            string `json:"role"`
	ContentText     string `json:"contentText"`
	CompletionState string `json:"completionState,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

type oauthAppMessagesView struct {
	Messages      []oauthAppMessageView `json:"messages"`
	HasMoreBefore bool                  `json:"hasMoreBefore"`
	NextBefore    string                `json:"nextBefore,omitempty"`
}

func (s *Server) mountOAuthApp(r chi.Router) {
	r.Get("/app", s.serveOAuthApp)
	r.Get("/app/", s.serveOAuthApp)
	r.Get("/app/auth/login", s.oauthAppLogin)
	r.Get("/app/auth/callback", s.oauthAppCallback)
	r.Get("/app/auth/session", s.oauthAppSession)
	r.Post("/app/auth/logout", s.oauthAppLogout)
	r.Get("/app/api/me", s.oauthAppMe)
	r.Get("/app/api/projects", s.oauthAppProjects)
	r.Get("/app/api/projects/{projectID}/agents", s.oauthAppAgents)
	r.Get("/app/api/projects/{projectID}/agents/{agentID}", s.oauthAppAgent)
	r.Get("/app/api/projects/{projectID}/agents/{agentID}/messages", s.oauthAppMessages)
	r.Post("/app/api/projects/{projectID}/agents/{agentID}/messages", s.oauthAppSubmitMessage)
}

func (s *Server) serveOAuthApp(w http.ResponseWriter, r *http.Request) {
	payload, err := staticFiles.ReadFile("static/oauth-app.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	setNoStore(w)
	setUIDocumentSecurityHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(payload)
}

func (s *Server) oauthAppLogin(w http.ResponseWriter, r *http.Request) {
	requestConfig, err := s.oauthAppConfig()
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return
	}
	party, err := s.oauthAppRelyingParty(r.Context(), requestConfig.OAuthApp)
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return
	}
	returnTo := r.URL.Query().Get("returnTo")
	request, err := party.BeginLogin(returnTo)
	if err != nil {
		writeOAuthAppError(w, http.StatusBadRequest, "invalid_login_request", "The requested application return path is invalid.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.setOAuthAppLoginCookie(w, request)
	http.Redirect(w, r, request.URL, http.StatusFound)
}

func (s *Server) oauthAppCallback(w http.ResponseWriter, r *http.Request) {
	browserBinding := ""
	if cookie, err := r.Cookie(oauthAppLoginCookieName); err == nil {
		browserBinding = cookie.Value
	}
	s.clearOAuthAppLoginCookie(w)

	requestConfig, err := s.oauthAppConfig()
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return
	}
	party, err := s.oauthAppRelyingParty(r.Context(), requestConfig.OAuthApp)
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return
	}
	result, err := party.HandleCallback(r.Context(), r.URL.Query(), browserBinding)
	if err != nil {
		writeOAuthAppError(w, http.StatusBadRequest, "invalid_oidc_callback", "OIDC login could not be completed. Start a new login attempt.")
		return
	}
	if !oauthAppAllowsIdentity(requestConfig.OAuthApp, result.Identity) {
		writeOAuthAppError(w, http.StatusForbidden, "oidc_identity_not_allowed", "This verified OIDC identity is not allowed to sign in.")
		return
	}

	identityRecord, identityErr := s.store.GetOAuthAppIdentity(r.Context(), result.Identity.Issuer, result.Identity.Subject)
	existingIdentity := identityErr == nil
	if identityErr != nil && !errors.Is(identityErr, sql.ErrNoRows) {
		writeOAuthAppError(w, http.StatusInternalServerError, "identity_lookup_failed", "OIDC identity lookup failed.")
		return
	}
	allowCreate := requestConfig.OAuthApp.AutoProvision || requestConfig.RegistrationOpen
	user, err := s.resolveOAuthAppUser(r.Context(), result.Identity, existingIdentity, allowCreate)
	if err != nil {
		status := http.StatusInternalServerError
		code := "identity_provision_failed"
		message := "OIDC account provisioning failed."
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, db.ErrConflict) {
			status = http.StatusForbidden
			code = "oidc_identity_not_allowed"
			message = "This OIDC identity is not linked to an available account."
		}
		writeOAuthAppError(w, status, code, message)
		return
	}
	if existingIdentity && identityRecord.UserID != user.ID {
		writeOAuthAppError(w, http.StatusForbidden, "oidc_identity_mismatch", "This OIDC identity is not linked to the resolved account.")
		return
	}

	rawToken, err := newSessionToken()
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "session_create_failed", "Application session creation failed.")
		return
	}
	now := s.clock().UTC()
	sessionTTL := oauthAppSessionTTL(requestConfig.OAuthApp)
	session := db.OAuthAppSession{
		ID:        db.NewID(),
		TokenHash: db.HashSessionToken(rawToken),
		UserID:    user.ID,
		Scopes:    oauthAppLocalScopes(requestConfig.OAuthApp),
		ExpiresAt: now.Add(sessionTTL).Format(time.RFC3339Nano),
	}
	if _, err := s.store.CreateOAuthAppSession(r.Context(), session); err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "session_create_failed", "Application session creation failed.")
		return
	}
	s.setOAuthAppSessionCookie(w, r, rawToken, sessionTTL)
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, result.RedirectAfter, http.StatusFound)
}

func (s *Server) oauthAppSession(w http.ResponseWriter, r *http.Request) {
	requestConfig, err := s.oauthAppConfig()
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	principal, ok, err := s.readOAuthAppPrincipal(r.Context(), r)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "session_lookup_failed", "Application session lookup failed.")
		return
	}
	if !ok {
		s.clearOAuthAppSessionCookie(w, r)
		writeJSON(w, http.StatusOK, oauthAppSessionView{Authenticated: false, Capabilities: oauthAppCapabilities{MaxPermissionMode: "readOnly"}})
		return
	}
	writeJSON(w, http.StatusOK, oauthAppSessionResponse(principal, requestConfig.OAuthApp))
}

func (s *Server) oauthAppLogout(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginRequest(r) {
		writeOAuthAppError(w, http.StatusForbidden, "cross_origin_request", "Cross-origin application requests are not allowed.")
		return
	}
	if cookie, err := r.Cookie(oauthAppSessionCookieName); err == nil && strings.TrimSpace(cookie.Value) != "" {
		if session, lookupErr := s.store.GetOAuthAppSessionByTokenHash(r.Context(), db.HashSessionToken(cookie.Value)); lookupErr == nil {
			if _, revokeErr := s.store.RevokeOAuthAppSession(r.Context(), session.ID); revokeErr != nil && !errors.Is(revokeErr, sql.ErrNoRows) {
				writeOAuthAppError(w, http.StatusInternalServerError, "logout_failed", "Application logout failed.")
				return
			}
		} else if !errors.Is(lookupErr, sql.ErrNoRows) {
			writeOAuthAppError(w, http.StatusInternalServerError, "logout_failed", "Application logout failed.")
			return
		}
	}
	s.clearOAuthAppSessionCookie(w, r)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) oauthAppMe(w http.ResponseWriter, r *http.Request) {
	principal, requestConfig, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeProfileRead)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, oauthAppSessionResponse(principal, requestConfig.OAuthApp))
}

func (s *Server) oauthAppProjects(w http.ResponseWriter, r *http.Request) {
	principal, _, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeProjectsRead)
	if !ok {
		return
	}
	projects, err := s.store.ListProjectsForUser(r.Context(), principal.User.ID)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "projects_lookup_failed", "Projects could not be loaded.")
		return
	}
	views := make([]oauthAppProjectView, 0, len(projects))
	for _, project := range projects {
		views = append(views, oauthAppProjectView{
			ID:          project.ID,
			Name:        project.Name,
			Description: project.Description,
			Status:      project.Status,
			Pinned:      project.Pinned,
			Archived:    project.ArchivedAt != "",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": views})
}

func (s *Server) oauthAppAgents(w http.ResponseWriter, r *http.Request) {
	principal, _, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeAgentsRead)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(chi.URLParam(r, "projectID"))
	if !s.requireOAuthAppProjectMember(w, r, principal.User.ID, projectID) {
		return
	}
	agents, err := s.oauthAppAgentsForProject(r.Context(), projectID)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "agents_lookup_failed", "Agents could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": agents})
}

func (s *Server) oauthAppAgent(w http.ResponseWriter, r *http.Request) {
	principal, _, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeAgentsRead)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(chi.URLParam(r, "projectID"))
	agentID := strings.TrimSpace(chi.URLParam(r, "agentID"))
	if !s.requireOAuthAppProjectMember(w, r, principal.User.ID, projectID) {
		return
	}
	view, ok, err := s.oauthAppAgentInProject(r.Context(), projectID, agentID)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "agent_lookup_failed", "Agent could not be loaded.")
		return
	}
	if !ok {
		writeOAuthAppError(w, http.StatusNotFound, "agent_not_found", "Agent was not found in this project.")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) oauthAppMessages(w http.ResponseWriter, r *http.Request) {
	principal, _, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeMessagesRead)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(chi.URLParam(r, "projectID"))
	agentID := strings.TrimSpace(chi.URLParam(r, "agentID"))
	if !s.requireOAuthAppProjectMember(w, r, principal.User.ID, projectID) {
		return
	}
	if _, found, err := s.oauthAppAgentInProject(r.Context(), projectID, agentID); err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "agent_lookup_failed", "Agent could not be loaded.")
		return
	} else if !found {
		writeOAuthAppError(w, http.StatusNotFound, "agent_not_found", "Agent was not found in this project.")
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeOAuthAppError(w, http.StatusBadRequest, "invalid_limit", "Message limit must be between 1 and 200.")
			return
		}
		limit = parsed
	}
	before := strings.TrimSpace(r.URL.Query().Get("cursor"))
	page, err := s.store.ListMessagesPage(r.Context(), agentID, before, limit)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "messages_lookup_failed", "Messages could not be loaded.")
		return
	}
	views := make([]oauthAppMessageView, 0, len(page.Messages))
	for _, message := range page.Messages {
		if oauthAppMessageIsToolResult(message) {
			continue
		}
		views = append(views, oauthAppMessageView{
			ID:              message.ID,
			Role:            message.Role,
			ContentText:     agentpkg.RedactToolActivityText(message.ContentText),
			CompletionState: message.CompletionState,
			CreatedAt:       message.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, oauthAppMessagesView{Messages: views, HasMoreBefore: page.HasMoreBefore, NextBefore: page.NextBefore})
}

func oauthAppMessageIsToolResult(message db.Message) bool {
	if strings.TrimSpace(message.ParentToolID) != "" || strings.EqualFold(strings.TrimSpace(message.Role), "tool") {
		return true
	}
	if len(message.ContentJSON) == 0 {
		return false
	}
	var blocks []struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(message.ContentJSON, &blocks); err != nil {
		return false
	}
	for _, block := range blocks {
		if strings.EqualFold(strings.TrimSpace(block.Type), "tool_result") {
			return true
		}
	}
	return false
}

func (s *Server) oauthAppSubmitMessage(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginRequest(r) {
		writeOAuthAppError(w, http.StatusForbidden, "cross_origin_request", "Cross-origin application requests are not allowed.")
		return
	}
	principal, requestConfig, ok := s.requireOAuthAppPrincipal(w, r, oauthAppScopeReadOnlyTaskWrite)
	if !ok {
		return
	}
	if !requestConfig.OAuthApp.AllowReadOnlyTasks {
		writeOAuthAppError(w, http.StatusForbidden, "insufficient_scope", "Read-only task submission is disabled by the current application policy.")
		return
	}
	projectID := strings.TrimSpace(chi.URLParam(r, "projectID"))
	agentID := strings.TrimSpace(chi.URLParam(r, "agentID"))
	if !s.requireOAuthAppProjectMember(w, r, principal.User.ID, projectID) {
		return
	}
	if _, found, err := s.oauthAppAgentInProject(r.Context(), projectID, agentID); err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "agent_lookup_failed", "Agent could not be loaded.")
		return
	} else if !found {
		writeOAuthAppError(w, http.StatusNotFound, "agent_not_found", "Agent was not found in this project.")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeOAuthAppError(w, http.StatusUnsupportedMediaType, "invalid_content_type", "Content-Type must be application/json.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	var request struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeOAuthAppError(w, http.StatusBadRequest, "invalid_request", "A single JSON content field is required.")
		return
	}
	request.Content = strings.TrimSpace(request.Content)
	if request.Content == "" || !utf8.ValidString(request.Content) || utf8.RuneCountInString(request.Content) > oauthAppMaxMessageRunes {
		writeOAuthAppError(w, http.StatusBadRequest, "invalid_content", "Message content is empty, invalid, or too long.")
		return
	}
	if s.runner == nil {
		writeOAuthAppError(w, http.StatusServiceUnavailable, "runner_unavailable", "Agent execution is unavailable.")
		return
	}
	message, err := s.runner.SubmitUserMessageWithModeAndPermissionCap(r.Context(), agentID, request.Content, principal.User.ID, agentpkg.ExecutionModeExecute, "readOnly")
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "message_submit_failed", "The read-only task could not be submitted.")
		return
	}
	writeJSON(w, http.StatusAccepted, oauthAppMessageView{ID: message.ID, Role: message.Role, ContentText: message.ContentText, CompletionState: message.CompletionState, CreatedAt: message.CreatedAt})
}

func (s *Server) oauthAppConfig() (oauthAppRequestConfig, error) {
	s.cfgMu.RLock()
	requestConfig := oauthAppRequestConfig{OAuthApp: s.cfg.Auth.OAuthApp, RegistrationOpen: s.cfg.Auth.RegistrationOpen}
	s.cfgMu.RUnlock()
	requestConfig.OAuthApp = requestConfig.OAuthApp.Normalized()
	if !requestConfig.OAuthApp.Enabled {
		return oauthAppRequestConfig{}, errOAuthAppDisabled
	}
	if err := requestConfig.OAuthApp.Validate(); err != nil {
		return oauthAppRequestConfig{}, err
	}
	return requestConfig, nil
}

func (s *Server) oauthAppRelyingParty(ctx context.Context, appConfig config.OAuthAppConfig) (*oauthapp.RelyingParty, error) {
	secret, err := appConfig.ClientSecret()
	if err != nil {
		return nil, err
	}
	key := oauthAppRuntimeKey(appConfig, secret)
	now := s.clock().UTC()
	s.oauthAppMu.Lock()
	defer s.oauthAppMu.Unlock()
	if s.oauthApp != nil && s.oauthApp.key == key {
		if s.oauthApp.party != nil {
			return s.oauthApp.party, nil
		}
		if s.oauthApp.lastErr != nil && now.Sub(s.oauthApp.lastAttempt) < oauthAppDiscoveryRetry {
			return nil, s.oauthApp.lastErr
		}
	}
	party, err := oauthapp.NewRelyingParty(ctx, oauthapp.Config{
		IssuerURL:    appConfig.IssuerURL,
		ClientID:     appConfig.ClientID,
		ClientSecret: secret,
		RedirectURL:  appConfig.RedirectURL,
		Scopes:       []string{"openid", "profile", "email"},
		HTTPClient:   s.integrationClient,
		Now:          s.clock,
	})
	s.oauthApp = &oauthAppRuntime{key: key, party: party, lastErr: err, lastAttempt: now}
	return party, err
}

func oauthAppAllowsIdentity(appConfig config.OAuthAppConfig, identity oauthapp.Identity) bool {
	return appConfig.AllowsEmail(identity.Email, identity.EmailVerified)
}

func oauthAppRuntimeKey(appConfig config.OAuthAppConfig, secret string) string {
	digest := sha256.Sum256([]byte(strings.Join([]string{
		appConfig.IssuerURL,
		appConfig.ClientID,
		appConfig.RedirectURL,
		strings.Join([]string{"openid", "profile", "email"}, "\x00"),
		secret,
	}, "\x01")))
	return hex.EncodeToString(digest[:])
}

func (s *Server) resolveOAuthAppUser(ctx context.Context, identity oauthapp.Identity, existingIdentity, allowCreate bool) (db.User, error) {
	provision := db.OAuthAppUserProvision{
		Issuer:      identity.Issuer,
		Subject:     identity.Subject,
		Email:       identity.Email,
		DisplayName: identity.Name,
	}
	if existingIdentity {
		user, _, err := s.store.FindOrCreateOAuthAppUser(ctx, provision, false)
		return user, err
	}
	rawPassword, err := newSessionToken()
	if err != nil {
		return db.User{}, err
	}
	passwordHash, err := hashUserPassword(rawPassword)
	if err != nil {
		return db.User{}, err
	}
	provision.PasswordHash = passwordHash
	candidates := oauthAppHandleCandidates(identity)
	for _, candidate := range candidates {
		provision.Handle = candidate
		user, _, err := s.store.FindOrCreateOAuthAppUser(ctx, provision, allowCreate)
		if err == nil {
			return user, nil
		}
		if !errors.Is(err, db.ErrConflict) {
			return db.User{}, err
		}
		if user, _, lookupErr := s.store.FindOrCreateOAuthAppUser(ctx, provision, false); lookupErr == nil {
			return user, nil
		}
	}
	return db.User{}, fmt.Errorf("%w: no unique OIDC handle candidate", db.ErrConflict)
}

func oauthAppHandleCandidates(identity oauthapp.Identity) []string {
	base := sanitizeOAuthAppHandle(identity.PreferredUsername)
	if base == "" {
		if local, _, ok := strings.Cut(identity.Email, "@"); ok {
			base = sanitizeOAuthAppHandle(local)
		}
	}
	if base == "" {
		base = sanitizeOAuthAppHandle(identity.Name)
	}
	digest := sha256.Sum256([]byte(identity.Issuer + "\x00" + identity.Subject))
	suffix := hex.EncodeToString(digest[:])
	if base == "" {
		base = "oidc-" + suffix[:12]
	}
	base = truncateRunes(strings.Trim(base, "-_"), 48)
	if base == "" {
		base = "oidc-" + suffix[:12]
	}
	candidates := []string{base}
	for index := 0; index < 5; index++ {
		start := index * 6
		candidates = append(candidates, truncateRunes(base, 48)+"-"+suffix[start:start+6])
	}
	return candidates
}

func sanitizeOAuthAppHandle(raw string) string {
	var builder strings.Builder
	lastSeparator := false
	for _, char := range strings.TrimSpace(raw) {
		switch {
		case unicode.IsLetter(char) || unicode.IsNumber(char):
			builder.WriteRune(char)
			lastSeparator = false
		case char == '-' || char == '_':
			if builder.Len() > 0 && !lastSeparator {
				builder.WriteRune(char)
				lastSeparator = true
			}
		}
	}
	return truncateRunes(strings.Trim(builder.String(), "-_"), 48)
}

func truncateRunes(value string, max int) string {
	if max < 1 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func oauthAppLocalScopes(appConfig config.OAuthAppConfig) []string {
	scopes := []string{oauthAppScopeProfileRead, oauthAppScopeProjectsRead, oauthAppScopeAgentsRead, oauthAppScopeMessagesRead}
	if appConfig.AllowReadOnlyTasks {
		scopes = append(scopes, oauthAppScopeReadOnlyTaskWrite)
	}
	return scopes
}

func oauthAppSessionTTL(appConfig config.OAuthAppConfig) time.Duration {
	hours := appConfig.Normalized().SessionTTLHours
	if hours < 1 {
		hours = 8
	}
	return time.Duration(hours) * time.Hour
}

func oauthAppSessionResponse(principal oauthAppPrincipal, appConfig config.OAuthAppConfig) oauthAppSessionView {
	displayName := principal.User.Handle
	return oauthAppSessionView{
		Authenticated: true,
		User: &oauthAppUserView{
			ID:          principal.User.ID,
			Handle:      principal.User.Handle,
			DisplayName: displayName,
			Role:        principal.User.Role,
		},
		Capabilities: oauthAppCapabilities{
			ReadOnlyTaskSubmission: appConfig.AllowReadOnlyTasks && oauthAppSessionHasScope(principal.Session, oauthAppScopeReadOnlyTaskWrite),
			MaxPermissionMode:      "readOnly",
		},
	}
}

func (s *Server) readOAuthAppPrincipal(ctx context.Context, r *http.Request) (oauthAppPrincipal, bool, error) {
	cookie, err := r.Cookie(oauthAppSessionCookieName)
	if errors.Is(err, http.ErrNoCookie) || strings.TrimSpace(cookie.Value) == "" {
		return oauthAppPrincipal{}, false, nil
	}
	if err != nil {
		return oauthAppPrincipal{}, false, err
	}
	session, err := s.store.GetOAuthAppSessionByTokenHash(ctx, db.HashSessionToken(cookie.Value))
	if errors.Is(err, sql.ErrNoRows) {
		return oauthAppPrincipal{}, false, nil
	}
	if err != nil {
		return oauthAppPrincipal{}, false, err
	}
	user, err := s.store.GetUser(ctx, session.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return oauthAppPrincipal{}, false, nil
	}
	if err != nil {
		return oauthAppPrincipal{}, false, err
	}
	if lastSeen, parseErr := time.Parse(time.RFC3339Nano, session.LastSeenAt); parseErr == nil && s.clock().UTC().Sub(lastSeen) >= 5*time.Minute {
		_, _ = s.store.TouchOAuthAppSession(ctx, session.ID, s.clock().UTC().Format(time.RFC3339Nano))
	}
	return oauthAppPrincipal{Session: session, User: user}, true, nil
}

func (s *Server) requireOAuthAppPrincipal(w http.ResponseWriter, r *http.Request, scope string) (oauthAppPrincipal, oauthAppRequestConfig, bool) {
	requestConfig, err := s.oauthAppConfig()
	if err != nil {
		s.writeOAuthAppConfigError(w, err)
		return oauthAppPrincipal{}, oauthAppRequestConfig{}, false
	}
	w.Header().Set("Cache-Control", "no-store")
	principal, ok, err := s.readOAuthAppPrincipal(r.Context(), r)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "session_lookup_failed", "Application session lookup failed.")
		return oauthAppPrincipal{}, oauthAppRequestConfig{}, false
	}
	if !ok {
		s.clearOAuthAppSessionCookie(w, r)
		writeOAuthAppError(w, http.StatusUnauthorized, "unauthenticated", "OIDC application login is required.")
		return oauthAppPrincipal{}, oauthAppRequestConfig{}, false
	}
	if scope != "" && !oauthAppSessionHasScope(principal.Session, scope) {
		writeOAuthAppError(w, http.StatusForbidden, "insufficient_scope", "The application session does not grant this operation.")
		return oauthAppPrincipal{}, oauthAppRequestConfig{}, false
	}
	return principal, requestConfig, true
}

func oauthAppSessionHasScope(session db.OAuthAppSession, required string) bool {
	for _, scope := range session.Scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func (s *Server) requireOAuthAppProjectMember(w http.ResponseWriter, r *http.Request, userID, projectID string) bool {
	if projectID == "" {
		writeOAuthAppError(w, http.StatusNotFound, "project_not_found", "Project was not found.")
		return false
	}
	member, err := s.store.IsProjectMember(r.Context(), userID, projectID)
	if err != nil {
		writeOAuthAppError(w, http.StatusInternalServerError, "project_access_failed", "Project access could not be verified.")
		return false
	}
	if !member {
		writeOAuthAppError(w, http.StatusForbidden, "project_forbidden", "The current account cannot access this project.")
		return false
	}
	return true
}

func (s *Server) oauthAppAgentsForProject(ctx context.Context, projectID string) ([]oauthAppAgentView, error) {
	worklines, err := s.store.ListWorklinesByProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	views := make([]oauthAppAgentView, 0)
	for _, workline := range worklines {
		agents, err := s.store.ListAgentsByWorkline(ctx, workline.ID)
		if err != nil {
			return nil, err
		}
		for _, agent := range agents {
			views = append(views, oauthAppAgentView{
				ID:         agent.ID,
				ProjectID:  projectID,
				WorklineID: workline.ID,
				Name:       agent.Title,
				Type:       agent.Type,
				Status:     agent.Status,
				Pinned:     agent.Pinned,
				Archived:   agent.ArchivedAt != "",
			})
		}
	}
	sort.SliceStable(views, func(i, j int) bool {
		if views[i].Pinned != views[j].Pinned {
			return views[i].Pinned
		}
		return strings.ToLower(views[i].Name) < strings.ToLower(views[j].Name)
	})
	return views, nil
}

func (s *Server) oauthAppAgentInProject(ctx context.Context, projectID, agentID string) (oauthAppAgentView, bool, error) {
	if projectID == "" || agentID == "" {
		return oauthAppAgentView{}, false, nil
	}
	agent, err := s.store.GetAgent(ctx, agentID)
	if errors.Is(err, sql.ErrNoRows) {
		return oauthAppAgentView{}, false, nil
	}
	if err != nil {
		return oauthAppAgentView{}, false, err
	}
	workline, err := s.store.GetWorkline(ctx, agent.WorklineID)
	if errors.Is(err, sql.ErrNoRows) || workline.ProjectID != projectID {
		return oauthAppAgentView{}, false, nil
	}
	if err != nil {
		return oauthAppAgentView{}, false, err
	}
	return oauthAppAgentView{
		ID:         agent.ID,
		ProjectID:  projectID,
		WorklineID: workline.ID,
		Name:       agent.Title,
		Type:       agent.Type,
		Status:     agent.Status,
		Pinned:     agent.Pinned,
		Archived:   agent.ArchivedAt != "",
	}, true, nil
}

func (s *Server) setOAuthAppLoginCookie(w http.ResponseWriter, authorization oauthapp.AuthorizationRequest) {
	ttl := authorization.ExpiresAt.Sub(s.clock().UTC())
	maxAge := int(ttl / time.Second)
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthAppLoginCookieName,
		Value:    authorization.BrowserBinding,
		Path:     oauthAppCallbackPath,
		MaxAge:   maxAge,
		Expires:  authorization.ExpiresAt.UTC(),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearOAuthAppLoginCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthAppLoginCookieName,
		Value:    "",
		Path:     oauthAppCallbackPath,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) setOAuthAppSessionCookie(w http.ResponseWriter, r *http.Request, rawToken string, ttl time.Duration) {
	maxAge := int(ttl / time.Second)
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthAppSessionCookieName,
		Value:    rawToken,
		Path:     "/app",
		MaxAge:   maxAge,
		Expires:  s.clock().UTC().Add(ttl),
		HttpOnly: true,
		Secure:   requestIsHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearOAuthAppSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthAppSessionCookieName,
		Value:    "",
		Path:     "/app",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
		HttpOnly: true,
		Secure:   requestIsHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) writeOAuthAppConfigError(w http.ResponseWriter, err error) {
	if errors.Is(err, errOAuthAppDisabled) {
		writeOAuthAppError(w, http.StatusServiceUnavailable, "oidc_disabled", "OIDC login is disabled for the application.")
		return
	}
	writeOAuthAppError(w, http.StatusServiceUnavailable, "oidc_not_configured", "OIDC login is unavailable or not configured correctly.")
}

func writeOAuthAppError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
