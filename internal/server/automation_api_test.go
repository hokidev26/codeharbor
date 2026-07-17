package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/devices"
)

func newAutomationAPIServer(t *testing.T) (*db.Store, *Server, db.Agent) {
	t.Helper()
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, agentRecord, err := store.CreateProject(context.Background(), "Automation API", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, New(config.Config{}, store, nil, nil), agentRecord
}

func TestPairingCodeResponseNeverLeaksHash(t *testing.T) {
	store, app, agentRecord := newAutomationAPIServer(t)
	defer store.Close()
	connection, err := store.CreateIntegrationConnection(context.Background(), db.IntegrationConnection{
		Kind: "telegram", Name: "bot", Enabled: true, Endpoint: telegramOfficialEndpoint,
		SettingsJSON: json.RawMessage(`{}`), SecretRefs: map[string]string{"botToken": "env:TG_BOT_TOKEN"},
	})
	if err != nil {
		t.Fatal(err)
	}
	response := serveJSON(t, app.Routes(), http.MethodPost, "/api/channels/pairing-codes", map[string]any{"connectionId": connection.ID, "agentId": agentRecord.ID})
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(strings.ToLower(body), "codehash") || strings.Contains(strings.ToLower(body), "code_hash") {
		t.Fatalf("pairing response leaked hash field: %s", body)
	}
	var payload struct {
		Code    string            `json:"code"`
		Pairing db.ChannelPairing `json:"pairing"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetChannelPairing(context.Background(), payload.Pairing.ID)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Code == "" || stored.CodeHash == "" || strings.Contains(body, stored.CodeHash) || strings.Contains(body, payload.Code+payload.Code) {
		t.Fatalf("unexpected pairing code persistence/response: code=%q stored=%+v body=%s", payload.Code, stored, body)
	}
}

func TestIntegrationConnectionNeverEchoesSecretReference(t *testing.T) {
	store, app, _ := newAutomationAPIServer(t)
	defer store.Close()
	response := serveJSON(t, app.Routes(), http.MethodPost, "/api/integrations/connections/", map[string]any{
		"kind": "telegram", "name": "notifications", "enabled": true, "endpoint": telegramOfficialEndpoint,
		"settings": map[string]any{}, "secretRefs": map[string]string{"botToken": "env:TOP_SECRET_BOT_TOKEN"},
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "env:TOP_SECRET_BOT_TOKEN") || strings.Contains(body, "TOP_SECRET_BOT_TOKEN") || strings.Contains(body, "secretRefs") {
		t.Fatalf("integration response leaked secret reference: %s", body)
	}
	if !strings.Contains(body, `"secretConfigured":{"botToken":true}`) {
		t.Fatalf("expected safe configured marker, got %s", body)
	}
}

func TestHomeAssistantConnectionRejectsPublicSecretDestination(t *testing.T) {
	store, app, _ := newAutomationAPIServer(t)
	defer store.Close()
	response := serveJSON(t, app.Routes(), http.MethodPost, "/api/integrations/connections/", map[string]any{
		"kind": "home-assistant", "name": "unsafe", "enabled": true, "endpoint": "https://example.test",
		"settings": map[string]any{}, "secretRefs": map[string]string{"accessToken": "env:HA_ACCESS_TOKEN"},
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected public Home Assistant endpoint rejection, got %d: %s", response.Code, response.Body.String())
	}
}

type fakeDeviceAdapter struct {
	mu       sync.Mutex
	executed int
}

func (a *fakeDeviceAdapter) ListDevices(context.Context) ([]devices.Device, error) {
	return []devices.Device{{ID: "light.office", Name: "Office", Domain: "light", State: "off", Attributes: map[string]any{}}}, nil
}
func (a *fakeDeviceAdapter) ListEntities(ctx context.Context) ([]devices.Entity, error) {
	return a.ListDevices(ctx)
}
func (a *fakeDeviceAdapter) ValidateAction(action devices.Action) error {
	return devices.ValidateAction(action)
}
func (a *fakeDeviceAdapter) CanonicalAction(action devices.Action) (devices.Action, error) {
	return devices.CanonicalAction(action)
}
func (a *fakeDeviceAdapter) Risk(action devices.Action) devices.RiskLevel {
	return devices.Risk(action)
}
func (a *fakeDeviceAdapter) Execute(context.Context, devices.Action) error {
	a.mu.Lock()
	a.executed++
	a.mu.Unlock()
	return nil
}
func (a *fakeDeviceAdapter) count() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.executed
}

func TestDeviceActionRequiresDirectLoopbackSecondConfirmationAndBlocksUnknown(t *testing.T) {
	store, app, _ := newAutomationAPIServer(t)
	defer store.Close()
	if _, err := store.CreateIntegrationConnection(context.Background(), db.IntegrationConnection{
		ID: "ha-1", Kind: devices.HomeAssistantKind, Name: "home", Enabled: true, Endpoint: "http://127.0.0.1:8123",
		SettingsJSON: json.RawMessage(`{}`), SecretRefs: map[string]string{"accessToken": "env:HA_ACCESS_TOKEN"},
	}); err != nil {
		t.Fatal(err)
	}
	adapter := &fakeDeviceAdapter{}
	app.SetDeviceAdapterFactory(func(context.Context, string) (devices.Adapter, error) { return adapter, nil })
	routes := app.Routes()

	created := serveJSON(t, routes, http.MethodPost, "/api/device-actions", map[string]any{
		"connectionId": "ha-1", "domain": "light", "service": "turn_on", "input": map[string]any{"entity_id": "light.office", "brightness": 120},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("expected pending action 201, got %d: %s", created.Code, created.Body.String())
	}
	var action db.DeviceActionRequest
	if err := json.Unmarshal(created.Body.Bytes(), &action); err != nil {
		t.Fatal(err)
	}
	if action.Status != "pending" || adapter.count() != 0 {
		t.Fatalf("action must be pending before local confirmation: %+v count=%d", action, adapter.count())
	}

	remote := newTestRequest(http.MethodPost, "/api/device-actions/"+action.ID+"/approve", nil)
	remote.RemoteAddr = "203.0.113.10:1234"
	remoteRecorder := httptest.NewRecorder()
	routes.ServeHTTP(remoteRecorder, remote)
	if remoteRecorder.Code != http.StatusForbidden || adapter.count() != 0 {
		t.Fatalf("remote approval should be denied, status=%d count=%d", remoteRecorder.Code, adapter.count())
	}

	forwarded := newTestRequest(http.MethodPost, "/api/device-actions/"+action.ID+"/approve", nil)
	forwarded.RemoteAddr = "127.0.0.1:1234"
	forwarded.Header.Set("X-Forwarded-For", "127.0.0.1")
	forwardedRecorder := httptest.NewRecorder()
	routes.ServeHTTP(forwardedRecorder, forwarded)
	if forwardedRecorder.Code != http.StatusForbidden || adapter.count() != 0 {
		t.Fatalf("forwarded approval should be denied, status=%d count=%d", forwardedRecorder.Code, adapter.count())
	}

	local := newTestRequest(http.MethodPost, "/api/device-actions/"+action.ID+"/approve", nil)
	local.RemoteAddr = "127.0.0.1:1234"
	localRecorder := httptest.NewRecorder()
	routes.ServeHTTP(localRecorder, local)
	if localRecorder.Code != http.StatusOK || adapter.count() != 1 {
		t.Fatalf("direct loopback approval should execute once, status=%d count=%d body=%s", localRecorder.Code, adapter.count(), localRecorder.Body.String())
	}

	again := newTestRequest(http.MethodPost, "/api/device-actions/"+action.ID+"/approve", nil)
	again.RemoteAddr = "127.0.0.1:1234"
	againRecorder := httptest.NewRecorder()
	routes.ServeHTTP(againRecorder, again)
	if againRecorder.Code != http.StatusConflict || adapter.count() != 1 {
		t.Fatalf("second approval must not execute again, status=%d count=%d", againRecorder.Code, adapter.count())
	}

	blocked := serveJSON(t, routes, http.MethodPost, "/api/device-actions", map[string]any{
		"connectionId": "ha-1", "domain": "lock", "service": "unlock", "input": map[string]any{"entity_id": "lock.front"},
	})
	if blocked.Code != http.StatusForbidden || adapter.count() != 1 {
		t.Fatalf("blocked/critical action must never be created, status=%d count=%d", blocked.Code, adapter.count())
	}
}

func TestMonitoringSnapshotAggregatesAutomationStats(t *testing.T) {
	ctx := context.Background()
	store, app, agentRecord := newAutomationAPIServer(t)
	defer store.Close()
	connection, err := store.CreateIntegrationConnection(ctx, db.IntegrationConnection{Kind: "telegram", Name: "stats", Enabled: true, Endpoint: telegramOfficialEndpoint, SettingsJSON: json.RawMessage(`{}`), SecretRefs: map[string]string{"botToken": "env:TG_STATS_TOKEN"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSchedule(ctx, db.Schedule{Name: "stats", AgentID: agentRecord.ID, Expression: "@daily", Timezone: "UTC", Prompt: "run", PermissionMode: "readOnly", Enabled: true, NextRunAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateNotificationDelivery(ctx, db.NotificationDelivery{DedupeKey: "monitor-delivery", SinkType: "webhook", SinkID: "https://example.invalid/hook", EventType: "test", PayloadJSON: json.RawMessage(`{"event":"test"}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateChannelPairing(ctx, db.ChannelPairing{ConnectionID: connection.ID, AgentID: agentRecord.ID, Status: "pending", CodeHash: strings.Repeat("a", 64), ExpiresAt: time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDeviceActionRequest(ctx, db.DeviceActionRequest{ConnectionID: connection.ID, EntityID: "light.office", Domain: "light", Service: "turn_on", PayloadJSON: json.RawMessage(`{"entity_id":"light.office"}`), Risk: "medium", Status: "pending", RequestedBy: "test", ExpiresAt: time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, newTestRequest(http.MethodGet, "/api/monitoring/snapshot", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected monitoring 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var snapshot monitoringSnapshotResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Schedules.Total != 1 || snapshot.Deliveries.Total != 1 || snapshot.Channels.Pairings.Total != 1 || snapshot.DeviceActions.Total != 1 {
		t.Fatalf("unexpected monitoring aggregation: %+v", snapshot)
	}
	if snapshot.ScheduleCount != 1 || snapshot.NotificationCount != 1 || snapshot.ChannelCount != 1 || snapshot.DeviceCount != 0 {
		t.Fatalf("unexpected monitoring headline counts: %+v", snapshot)
	}
}

func serveJSON(t *testing.T, handler http.Handler, method, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := newTestRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
