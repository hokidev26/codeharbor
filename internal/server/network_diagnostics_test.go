package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
	"autoto/internal/network"
)

type fakeServerNetworkDiagnostics struct {
	calls     int
	target    network.Target
	remaining time.Duration
	result    network.DiagnosticResult
	err       error
}

func (f *fakeServerNetworkDiagnostics) Run(ctx context.Context, target network.Target) (network.DiagnosticResult, error) {
	f.calls++
	f.target = target
	if deadline, ok := ctx.Deadline(); ok {
		f.remaining = time.Until(deadline)
	}
	return f.result, f.err
}

func TestNetworkDiagnosticsCatalogExposesOnlyFixedEnumeration(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	serverNetworkDiagnosticsStates.Delete(app)
	t.Cleanup(func() { serverNetworkDiagnosticsStates.Delete(app) })
	router := chi.NewRouter()
	router.Get("/network-diagnostics", app.getNetworkDiagnostics)

	if _, loaded := serverNetworkDiagnosticsStates.Load(app); loaded {
		t.Fatal("diagnostics initialized before first request")
	}
	response := executionControlRequest(router, http.MethodGet, "/network-diagnostics", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if _, loaded := serverNetworkDiagnosticsStates.Load(app); !loaded {
		t.Fatal("diagnostics were not lazily initialized")
	}
	var catalog networkDiagnosticsCatalogResponse
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Targets) != len(fixedNetworkDiagnosticTargets) {
		t.Fatalf("unexpected targets: %v", catalog.Targets)
	}
	for index, target := range fixedNetworkDiagnosticTargets {
		if catalog.Targets[index] != target {
			t.Fatalf("unexpected target order: %v", catalog.Targets)
		}
	}
	if len(catalog.PolicyMatrix) != 3 || len(catalog.PolicyMatrix[network.PolicyEnvironmentProxy]) != 3 || len(catalog.PolicyMatrix[network.PolicyPublicDirect]) != 1 || len(catalog.PolicyMatrix[network.PolicyPrivateLANDirect]) != 1 {
		t.Fatalf("unexpected policy matrix: %+v", catalog.PolicyMatrix)
	}
	if strings.Contains(response.Body.String(), "http://") || strings.Contains(response.Body.String(), "https://") {
		t.Fatalf("catalog exposed a target URL: %s", response.Body.String())
	}

	query := executionControlRequest(router, http.MethodGet, "/network-diagnostics?url=https://attacker.invalid/", nil)
	if query.Code != http.StatusBadRequest || strings.Contains(query.Body.String(), "attacker.invalid") {
		t.Fatalf("diagnostic query URL was not safely rejected: %d %s", query.Code, query.Body.String())
	}
}

func TestRunNetworkDiagnosticRejectsURLsAndReturnsCoarseResult(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	fake := &fakeServerNetworkDiagnostics{result: network.DiagnosticResult{
		Target: network.TargetOpenAIAPI, Policy: network.PolicyEnvironmentProxy, LatencyMS: 37,
		StatusClass: network.StatusClassSuccess, ProxyConfigured: true,
	}}
	installServerNetworkDiagnostics(t, app, fake)
	router := chi.NewRouter()
	router.Post("/network-diagnostics", app.runNetworkDiagnostic)

	urlField := executionControlRawRequest(router, http.MethodPost, "/network-diagnostics", `{"target":"public_internet","url":"https://attacker.invalid/?token=url-marker"}`)
	if urlField.Code != http.StatusBadRequest || fake.calls != 0 || strings.Contains(urlField.Body.String(), "attacker.invalid") || strings.Contains(urlField.Body.String(), "url-marker") {
		t.Fatalf("arbitrary URL field was not safely rejected: %d calls=%d body=%s", urlField.Code, fake.calls, urlField.Body.String())
	}

	unknown := executionControlRawRequest(router, http.MethodPost, "/network-diagnostics", `{"target":"https://attacker.invalid/?token=target-marker"}`)
	if unknown.Code != http.StatusBadRequest || fake.calls != 0 || strings.Contains(unknown.Body.String(), "attacker.invalid") || strings.Contains(unknown.Body.String(), "target-marker") {
		t.Fatalf("unknown target was not safely rejected: %d calls=%d body=%s", unknown.Code, fake.calls, unknown.Body.String())
	}

	known := executionControlRawRequest(router, http.MethodPost, "/network-diagnostics", `{"target":"openai_api"}`)
	if known.Code != http.StatusOK || fake.calls != 1 || fake.target != network.TargetOpenAIAPI {
		t.Fatalf("known diagnostic failed: %d calls=%d target=%q body=%s", known.Code, fake.calls, fake.target, known.Body.String())
	}
	if fake.remaining < 2*time.Second || fake.remaining > 3*time.Second {
		t.Fatalf("diagnostic timeout was outside 2-3 seconds: %s", fake.remaining)
	}
	var result map[string]any
	if err := json.Unmarshal(known.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["target"] != string(network.TargetOpenAIAPI) || result["statusClass"] != string(network.StatusClassSuccess) || result["latencyMs"] != float64(37) {
		t.Fatalf("unexpected coarse result: %v", result)
	}
	for _, forbidden := range []string{"url", "error", "policy", "proxyConfigured", "proxy"} {
		if _, exists := result[forbidden]; exists {
			t.Fatalf("diagnostic result exposed %q: %v", forbidden, result)
		}
	}

	fake.err = errors.New("dial https://user:password@proxy.invalid/?token=raw-error-marker")
	failed := executionControlRawRequest(router, http.MethodPost, "/network-diagnostics", `{"target":"public_internet"}`)
	if failed.Code != http.StatusBadGateway || strings.Contains(failed.Body.String(), "proxy.invalid") || strings.Contains(failed.Body.String(), "raw-error-marker") || strings.Contains(failed.Body.String(), "user:password") {
		t.Fatalf("raw diagnostic error leaked: %d %s", failed.Code, failed.Body.String())
	}
}

func installServerNetworkDiagnostics(t *testing.T, app *Server, runner networkDiagnosticsRunner) {
	t.Helper()
	state := &serverNetworkDiagnosticsState{}
	state.once.Do(func() { state.runner = runner })
	serverNetworkDiagnosticsStates.Store(app, state)
	t.Cleanup(func() { serverNetworkDiagnosticsStates.Delete(app) })
}
