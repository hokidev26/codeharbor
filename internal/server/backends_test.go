package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestBackendsRouteWithoutTrailingSlash(t *testing.T) {
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/backends", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var backends []backendResponse
	if err := json.NewDecoder(recorder.Body).Decode(&backends); err != nil {
		t.Fatal(err)
	}
	if len(backends) != 0 {
		t.Fatalf("expected no backends, got %+v", backends)
	}
}

func TestCheckBackendHealthUsesOpenHandsServerDetails(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/alive", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})
	mux.HandleFunc("/server_info", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Session-API-Key") != "secret" {
			http.Error(w, "missing session key", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"title":"OpenHands Agent Server"}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	health := checkBackendHealth(context.Background(), db.Backend{ID: "backend-1", Name: "Local", Kind: "local", BaseURL: server.URL + "/api", APIKey: "secret"})
	if !health.OK || health.Status != "online" {
		t.Fatalf("expected online health, got %+v", health)
	}
	if health.Info["title"] != "OpenHands Agent Server" {
		t.Fatalf("expected server info, got %+v", health.Info)
	}
}
