package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"autoto/internal/config"
)

type stubShellDialogHost struct {
	confirmFn   func(ctx context.Context, message, title string) (bool, error)
	alertFn     func(ctx context.Context, message, title string) error
	directoryFn func(ctx context.Context, title, defaultPath string) (string, bool, error)
	fileFn      func(ctx context.Context, title, defaultPath string, filters []ShellFileFilter) (string, bool, error)
}

func (h stubShellDialogHost) Confirm(ctx context.Context, message, title string) (bool, error) {
	if h.confirmFn != nil {
		return h.confirmFn(ctx, message, title)
	}
	return false, nil
}

func (h stubShellDialogHost) Alert(ctx context.Context, message, title string) error {
	if h.alertFn != nil {
		return h.alertFn(ctx, message, title)
	}
	return nil
}

func (h stubShellDialogHost) PickDirectory(ctx context.Context, title, defaultPath string) (string, bool, error) {
	if h.directoryFn != nil {
		return h.directoryFn(ctx, title, defaultPath)
	}
	return "", true, nil
}

func (h stubShellDialogHost) PickFile(ctx context.Context, title, defaultPath string, filters []ShellFileFilter) (string, bool, error) {
	if h.fileFn != nil {
		return h.fileFn(ctx, title, defaultPath, filters)
	}
	return "", true, nil
}

func desktopDialogJSONBody(t *testing.T, payload map[string]any) *bytes.Reader {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(raw)
}

func TestDesktopDialogConfirmUnavailableWithoutHost(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/confirm", desktopDialogJSONBody(t, map[string]any{"message": "sure?"}))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestDesktopDialogConfirmLocal(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	var seen string
	app.SetShellDialogHost(stubShellDialogHost{
		confirmFn: func(_ context.Context, message, _ string) (bool, error) {
			seen = message
			return true, nil
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/confirm", desktopDialogJSONBody(t, map[string]any{"message": "delete project?"}))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["accepted"] != true {
		t.Fatalf("body=%v", body)
	}
	if seen != "delete project?" {
		t.Fatalf("seen message %q", seen)
	}
}

func TestDesktopDialogRejectsRemote(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	app.SetShellDialogHost(stubShellDialogHost{
		confirmFn: func(context.Context, string, string) (bool, error) {
			t.Fatal("host must not be called for remote peers")
			return false, nil
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/confirm", desktopDialogJSONBody(t, map[string]any{"message": "no"}))
	req.RemoteAddr = "203.0.113.10:4444"
	req.Host = "example.com"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("remote must not reach desktop dialogs, status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestDesktopDialogAlertLocal(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	called := false
	app.SetShellDialogHost(stubShellDialogHost{
		alertFn: func(_ context.Context, message, _ string) error {
			called = message == "hello"
			return nil
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/alert", desktopDialogJSONBody(t, map[string]any{"message": "hello"}))
	req.RemoteAddr = "127.0.0.1:9"
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !called {
		t.Fatal("alert host was not called")
	}
}

func TestDesktopDialogOpenDirectoryLocal(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	app.SetShellDialogHost(stubShellDialogHost{
		directoryFn: func(_ context.Context, title, defaultPath string) (string, bool, error) {
			if title == "" {
				t.Fatal("expected title")
			}
			if defaultPath != "/tmp" {
				t.Fatalf("defaultPath=%q", defaultPath)
			}
			return "/Users/demo/project", false, nil
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/open-directory", desktopDialogJSONBody(t, map[string]any{
		"title":       "Pick",
		"defaultPath": "/tmp",
	}))
	req.RemoteAddr = "127.0.0.1:9"
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["canceled"] != false || body["path"] != "/Users/demo/project" {
		t.Fatalf("body=%v", body)
	}
}

func TestDesktopDialogOpenFileCanceled(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	app.SetShellDialogHost(stubShellDialogHost{
		fileFn: func(context.Context, string, string, []ShellFileFilter) (string, bool, error) {
			return "", true, nil
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/dialog/open-file", desktopDialogJSONBody(t, map[string]any{
		"title":   "Open",
		"filters": []map[string]string{{"name": "JSON", "pattern": "*.json"}},
	}))
	req.RemoteAddr = "127.0.0.1:9"
	req.Host = "127.0.0.1:7788"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["canceled"] != true {
		t.Fatalf("body=%v", body)
	}
}
