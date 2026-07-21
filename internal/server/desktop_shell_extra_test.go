package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"autoto/internal/config"
	updatepkg "autoto/internal/update"
)

type stubLifecycleHost struct {
	enabled bool
	lastURL string
}

func (h *stubLifecycleHost) AutostartStatus() (bool, string, string, error) {
	return h.enabled, "test", "", nil
}
func (h *stubLifecycleHost) AutostartEnable() error {
	h.enabled = true
	return nil
}
func (h *stubLifecycleHost) AutostartDisable() error {
	h.enabled = false
	return nil
}
func (h *stubLifecycleHost) NotifyDeepLink(raw string) error {
	h.lastURL = raw
	return nil
}

type stubUpdateHost struct {
	home string
}

func (h stubUpdateHost) StageLocalUpdate(sourcePath, version, sha256 string) (updatepkg.PendingReplace, error) {
	return updatepkg.StageLocalBinary(h.home, sourcePath, version, sha256)
}
func (h stubUpdateHost) PendingUpdate() (updatepkg.PendingReplace, bool, error) {
	return updatepkg.ReadPendingReplace(h.home)
}
func (h stubUpdateHost) ClearPendingUpdate() error {
	return updatepkg.ClearPendingReplace(h.home)
}

func TestDesktopAutostartLocalOnly(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	host := &stubLifecycleHost{}
	app.SetShellLifecycleHost(host)

	req := httptest.NewRequest(http.MethodPost, "/api/desktop/autostart", nil)
	req.RemoteAddr = "127.0.0.1:9"
	req.Host = "127.0.0.1:7788"
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !host.enabled {
		t.Fatal("expected enabled")
	}

	remote := httptest.NewRequest(http.MethodPost, "/api/desktop/autostart", nil)
	remote.RemoteAddr = "203.0.113.9:9"
	remote.Host = "example.com"
	remoteRec := httptest.NewRecorder()
	app.Routes().ServeHTTP(remoteRec, remote)
	if remoteRec.Code == http.StatusOK {
		t.Fatal("remote must not control autostart")
	}
}

func TestDesktopDeepLinkRejectsNonAutoto(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	host := &stubLifecycleHost{}
	app.SetShellLifecycleHost(host)
	body, _ := json.Marshal(map[string]string{"url": "https://evil.example"})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/deep-link", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:1"
	req.Host = "127.0.0.1:1"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatal("expected reject")
	}

	body, _ = json.Marshal(map[string]string{"url": "autoto://agent?id=a1"})
	req = httptest.NewRequest(http.MethodPost, "/api/desktop/deep-link", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:1"
	req.Host = "127.0.0.1:1"
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if host.lastURL != "autoto://agent?id=a1" {
		t.Fatalf("lastURL=%q", host.lastURL)
	}
}

func TestDesktopUpdateStageLocalOnly(t *testing.T) {
	home := t.TempDir()
	app := New(config.Config{}, nil, nil, nil)
	app.SetShellUpdateHost(stubUpdateHost{home: home})

	src := filepath.Join(t.TempDir(), "bin")
	if err := os.WriteFile(src, []byte("payload"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{
		"sourcePath": src,
		"version":    "0.2.0",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/update/stage", bytes.NewReader(payload))
	req.RemoteAddr = "127.0.0.1:1"
	req.Host = "127.0.0.1:1"
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
	if body["pending"] != true || body["apply"] != "manual_restart" {
		t.Fatalf("body=%v", body)
	}

	// Remote cannot stage.
	remote := httptest.NewRequest(http.MethodPost, "/api/desktop/update/stage", bytes.NewReader(payload))
	remote.RemoteAddr = "198.51.100.2:1"
	remote.Host = "tunnel.example"
	remoteRec := httptest.NewRecorder()
	app.Routes().ServeHTTP(remoteRec, remote)
	if remoteRec.Code == http.StatusOK {
		t.Fatal("remote must not stage updates")
	}
}
