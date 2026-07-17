package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"autoto/internal/db"
)

const (
	authSessionCookieName = "autoto_session"
	authSessionLifetime   = 30 * 24 * time.Hour
)

type authCredentialsRequest struct {
	Handle   string `json:"handle"`
	Password string `json:"password"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var req authCredentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 1024 {
		writeError(w, http.StatusBadRequest, "password must be between 8 and 1024 bytes")
		return
	}
	hasUsers, err := s.store.HasUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hasUsers && !s.configSnapshot().Auth.RegistrationOpen {
		writeError(w, http.StatusForbidden, "registration is closed")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash password: "+err.Error())
		return
	}
	user, err := s.store.CreateUser(r.Context(), req.Handle, string(hash))
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, user)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req authCredentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, passwordHash, err := s.store.GetUserByHandle(r.Context(), req.Handle)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) != nil {
		// Keep account existence private from unauthenticated callers.
		writeError(w, http.StatusUnauthorized, "invalid handle or password")
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(authSessionCookieName); err == nil && cookie.Value != "" {
		if err := s.store.RevokeAuthSessionToken(r.Context(), cookie.Value); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	s.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user, ok, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "login required")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok, err := s.currentUser(r); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	} else if !ok {
		writeError(w, http.StatusUnauthorized, "login required")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	users, err := s.store.ListUsersByHandlePrefix(r.Context(), r.URL.Query().Get("handlePrefix"), limit)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) currentUser(r *http.Request) (db.User, bool, error) {
	if s.store == nil {
		return db.User{}, false, nil
	}
	cookie, err := r.Cookie(authSessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return db.User{}, false, nil
	}
	user, _, err := s.store.GetUserBySessionToken(r.Context(), cookie.Value, s.clock())
	if errors.Is(err, sql.ErrNoRows) {
		return db.User{}, false, nil
	}
	if err != nil {
		return db.User{}, false, err
	}
	return user, true, nil
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (db.User, bool) {
	user, ok, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return db.User{}, false
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "login required")
		return db.User{}, false
	}
	return user, true
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user db.User) error {
	token, err := newSessionToken()
	if err != nil {
		return err
	}
	now := s.clock().UTC()
	expiresAt := now.Add(authSessionLifetime)
	if _, err := s.store.CreateAuthSession(r.Context(), db.AuthSession{UserID: user.ID, TokenHash: db.HashSessionToken(token), CreatedAt: now.Format(time.RFC3339Nano), ExpiresAt: expiresAt.Format(time.RFC3339Nano)}); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: authSessionCookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: requestIsHTTPS(r), Expires: expiresAt, MaxAge: int(authSessionLifetime.Seconds())})
	return nil
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: authSessionCookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: requestIsHTTPS(r), MaxAge: -1, Expires: time.Unix(1, 0)})
}

func newSessionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
