package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
	"autoto/internal/db"
)

type executionControlFixture struct {
	store   *db.Store
	server  *Server
	routes  http.Handler
	project db.Project
	agent   db.Agent
}

func newExecutionControlFixture(t *testing.T) executionControlFixture {
	t.Helper()
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "execution-control.db"))
	if err != nil {
		t.Fatal(err)
	}
	project, _, agent, err := store.CreateProject(context.Background(), "Execution Control", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	app := New(config.Config{}, store, nil, nil)
	router := chi.NewRouter()
	router.Get("/execution-devices", app.listExecutionDevices)
	router.Post("/execution-devices/remote", app.registerRemoteExecutionDevice)
	router.Post("/execution-devices/{deviceId}/enable", app.enableRemoteExecutionDevice)
	router.Post("/execution-devices/{deviceId}/disable", app.disableRemoteExecutionDevice)
	router.Put("/projects/{projectId}/execution-devices/{deviceId}", app.setProjectExecutionDeviceGrant)
	router.Put("/agents/{agentId}/execution-device", app.setAgentExecutionDevice)
	router.Get("/remote-execution-tasks", app.listRemoteExecutionTasks)
	router.Post("/remote-execution-tasks", app.createRemoteExecutionTask)
	router.Get("/remote-execution-tasks/{taskId}", app.getRemoteExecutionTask)
	t.Cleanup(func() { _ = store.Close() })
	return executionControlFixture{store: store, server: app, routes: router, project: project, agent: agent}
}

func TestExecutionControlRegistrationRequiresAndRedactsFingerprint(t *testing.T) {
	fixture := newExecutionControlFixture(t)
	missing := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/execution-devices/remote", map[string]any{"name": "build-host"})
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("expected missing fingerprint rejection, got %d: %s", missing.Code, missing.Body.String())
	}

	fingerprint := "sha256:0123456789abcdef0123456789abcdef"
	created := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/execution-devices/remote", map[string]any{
		"name": "build-host", "fingerprint": fingerprint, "capabilities": map[string]any{"tools": []string{"Read"}},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", created.Code, created.Body.String())
	}
	body := created.Body.String()
	if strings.Contains(body, fingerprint) || strings.Contains(strings.ToLower(body), "fingerprint") {
		t.Fatalf("registration response leaked fingerprint: %s", body)
	}
	var device db.ExecutionDevice
	if err := json.Unmarshal(created.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}
	if device.Enabled || device.Status != "disabled" || device.Kind != "remote" {
		t.Fatalf("remote device was not disabled by default: %+v", device)
	}
	var storedFingerprint string
	if err := fixture.store.DB().QueryRowContext(context.Background(), `SELECT identity_fingerprint FROM execution_devices WHERE id = ?`, device.ID).Scan(&storedFingerprint); err != nil {
		t.Fatal(err)
	}
	if storedFingerprint != fingerprint {
		t.Fatalf("fingerprint was not persisted")
	}

	listed := executionControlRequest(fixture.routes, http.MethodGet, "/execution-devices", nil)
	if listed.Code != http.StatusOK || strings.Contains(listed.Body.String(), fingerprint) || strings.Contains(strings.ToLower(listed.Body.String()), "fingerprint") {
		t.Fatalf("device listing leaked fingerprint: %d %s", listed.Code, listed.Body.String())
	}

	unknown := executionControlRawRequest(fixture.routes, http.MethodPost, "/execution-devices/remote", `{"name":"other","fingerprint":"sha256:abcdef0123456789","url":"https://attacker.invalid/?secret=marker"}`)
	if unknown.Code != http.StatusBadRequest || strings.Contains(unknown.Body.String(), "attacker.invalid") || strings.Contains(unknown.Body.String(), "marker") {
		t.Fatalf("unknown registration field was not safely rejected: %d %s", unknown.Code, unknown.Body.String())
	}
}

func TestRemoteExecutionLedgerFailsClosedUntilReadyAndAuthorized(t *testing.T) {
	fixture := newExecutionControlFixture(t)
	ctx := context.Background()
	device, err := fixture.store.RegisterRemoteExecutionDevice(ctx, db.ExecutionDeviceRegistration{
		Name: "remote-ledger", IdentityFingerprint: "sha256:fedcba9876543210", Capabilities: json.RawMessage(`{"tools":["Read"]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	createPayload := func(key string, payload any) map[string]any {
		return map[string]any{
			"idempotencyKey":    key,
			"projectId":         fixture.project.ID,
			"agentId":           fixture.agent.ID,
			"executionDeviceId": device.ID,
			"payload":           payload,
		}
	}

	disabledMarker := "disabled-payload-marker"
	disabled := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/remote-execution-tasks", createPayload("disabled", map[string]any{"operation": "read", "note": disabledMarker}))
	assertSafeConflict(t, disabled, disabledMarker)

	enabled := executionControlRequest(fixture.routes, http.MethodPost, "/execution-devices/"+device.ID+"/enable", nil)
	if enabled.Code != http.StatusOK {
		t.Fatalf("enable failed: %d %s", enabled.Code, enabled.Body.String())
	}
	unready := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/remote-execution-tasks", createPayload("unready", map[string]any{"operation": "read"}))
	assertSafeConflict(t, unready, "operation")

	if _, err := fixture.store.DB().ExecContext(ctx, `UPDATE execution_devices SET status = 'ready' WHERE id = ?`, device.ID); err != nil {
		t.Fatal(err)
	}
	unauthorized := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/remote-execution-tasks", createPayload("unauthorized", map[string]any{"operation": "read"}))
	assertSafeConflict(t, unauthorized, "operation")

	grant := executionControlJSONRequest(t, fixture.routes, http.MethodPut, "/projects/"+fixture.project.ID+"/execution-devices/"+device.ID, map[string]any{"enabled": true, "capabilities": map[string]any{"tools": []string{"Read"}}})
	if grant.Code != http.StatusOK {
		t.Fatalf("grant failed: %d %s", grant.Code, grant.Body.String())
	}
	agentUpdate := executionControlJSONRequest(t, fixture.routes, http.MethodPut, "/agents/"+fixture.agent.ID+"/execution-device", map[string]any{"executionDeviceId": device.ID})
	if agentUpdate.Code != http.StatusOK {
		t.Fatalf("agent device update failed: %d %s", agentUpdate.Code, agentUpdate.Body.String())
	}
	localFallback := executionControlRequest(fixture.server.Routes(), http.MethodGet, "/api/agents/"+fixture.agent.ID+"/workspace/tree", nil)
	if localFallback.Code != http.StatusConflict || !strings.Contains(localFallback.Body.String(), "local fallback is forbidden") {
		t.Fatalf("remote-target workspace must fail closed, got %d: %s", localFallback.Code, localFallback.Body.String())
	}

	created := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/remote-execution-tasks", createPayload("accepted", map[string]any{"operation": "read", "path": "README.md"}))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected ledger creation, got %d: %s", created.Code, created.Body.String())
	}
	var ledger remoteExecutionTaskLedgerResponse
	if err := json.Unmarshal(created.Body.Bytes(), &ledger); err != nil {
		t.Fatal(err)
	}
	if ledger.ID == "" || ledger.Status != "queued" || ledger.TransportImplemented || !ledger.NoFallback {
		t.Fatalf("unexpected ledger response: %+v", ledger)
	}
	for _, forbidden := range []string{"leaseOwner", "leaseUntil", "lastError", `"result"`} {
		if strings.Contains(created.Body.String(), forbidden) {
			t.Fatalf("control-plane response exposed transport field %q: %s", forbidden, created.Body.String())
		}
	}

	got := executionControlRequest(fixture.routes, http.MethodGet, "/remote-execution-tasks/"+ledger.ID, nil)
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"transportImplemented":false`) {
		t.Fatalf("get ledger failed: %d %s", got.Code, got.Body.String())
	}
	listed := executionControlRequest(fixture.routes, http.MethodGet, "/remote-execution-tasks", nil)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), ledger.ID) || !strings.Contains(listed.Body.String(), `"transportImplemented":false`) {
		t.Fatalf("list ledger failed: %d %s", listed.Code, listed.Body.String())
	}

	sensitiveMarker := "raw-secret-value-never-echo"
	sensitive := executionControlJSONRequest(t, fixture.routes, http.MethodPost, "/remote-execution-tasks", createPayload("sensitive", map[string]any{"rawInput": sensitiveMarker}))
	if sensitive.Code != http.StatusBadRequest || strings.Contains(sensitive.Body.String(), sensitiveMarker) || strings.Contains(sensitive.Body.String(), "rawInput") {
		t.Fatalf("sensitive payload error leaked request data: %d %s", sensitive.Code, sensitive.Body.String())
	}

	unknownBody := executionControlRawRequest(fixture.routes, http.MethodPost, "/execution-devices/"+device.ID+"/disable", `{"enabled":false}`)
	if unknownBody.Code != http.StatusBadRequest {
		t.Fatalf("explicit disable accepted an unknown body field: %d %s", unknownBody.Code, unknownBody.Body.String())
	}
}

func assertSafeConflict(t *testing.T, response *httptest.ResponseRecorder, marker string) {
	t.Helper()
	if response.Code != http.StatusConflict || strings.Contains(response.Body.String(), marker) {
		t.Fatalf("expected safe fail-closed conflict, got %d: %s", response.Code, response.Body.String())
	}
}

func executionControlJSONRequest(t *testing.T, handler http.Handler, method, target string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return executionControlRequest(handler, method, target, encoded)
}

func executionControlRawRequest(handler http.Handler, method, target, payload string) *httptest.ResponseRecorder {
	return executionControlRequest(handler, method, target, []byte(payload))
}

func executionControlRequest(handler http.Handler, method, target string, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, bytes.NewReader(body))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
