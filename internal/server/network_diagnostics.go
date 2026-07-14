package server

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"autoto/internal/network"
)

const networkDiagnosticTimeout = 2500 * time.Millisecond

type networkDiagnosticsRunner interface {
	Run(context.Context, network.Target) (network.DiagnosticResult, error)
}

type serverNetworkDiagnosticsState struct {
	once   sync.Once
	runner networkDiagnosticsRunner
}

var serverNetworkDiagnosticsStates sync.Map

var fixedNetworkDiagnosticTargets = []network.Target{
	network.TargetOpenAIAPI,
	network.TargetAnthropicAPI,
	network.TargetTelegramAPI,
	network.TargetPublicInternet,
	network.TargetLocalCLIProxyAPI,
}

type networkDiagnosticsCatalogResponse struct {
	Targets      []network.Target                    `json:"targets"`
	PolicyMatrix map[network.Policy][]network.Target `json:"policyMatrix"`
}

type runNetworkDiagnosticRequest struct {
	Target network.Target `json:"target"`
}

type networkDiagnosticResultResponse struct {
	Target      network.Target      `json:"target"`
	LatencyMS   int64               `json:"latencyMs"`
	StatusClass network.StatusClass `json:"statusClass"`
}

func (s *Server) getNetworkDiagnostics(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Query()) != 0 {
		writeError(w, http.StatusBadRequest, "network diagnostics do not accept query parameters")
		return
	}
	if s == nil {
		writeError(w, http.StatusServiceUnavailable, "network diagnostics are unavailable")
		return
	}
	// Construction is deferred until the diagnostics control plane is first
	// requested. GET performs no probe and exposes no destination URL.
	_ = s.networkDiagnosticsRunner()
	writeJSON(w, http.StatusOK, networkDiagnosticsCatalogResponse{
		Targets: append([]network.Target(nil), fixedNetworkDiagnosticTargets...),
		PolicyMatrix: map[network.Policy][]network.Target{
			network.PolicyEnvironmentProxy: {
				network.TargetOpenAIAPI,
				network.TargetAnthropicAPI,
				network.TargetTelegramAPI,
			},
			network.PolicyPublicDirect: {
				network.TargetPublicInternet,
			},
			network.PolicyPrivateLANDirect: {
				network.TargetLocalCLIProxyAPI,
			},
		},
	})
}

func (s *Server) runNetworkDiagnostic(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Query()) != 0 {
		writeError(w, http.StatusBadRequest, "network diagnostics do not accept query parameters")
		return
	}
	var req runNetworkDiagnosticRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid network diagnostic request")
		return
	}
	if !isFixedNetworkDiagnosticTarget(req.Target) {
		writeError(w, http.StatusBadRequest, "invalid network diagnostic target")
		return
	}
	if s == nil {
		writeError(w, http.StatusServiceUnavailable, "network diagnostics are unavailable")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), networkDiagnosticTimeout)
	defer cancel()
	result, err := s.networkDiagnosticsRunner().Run(ctx, req.Target)
	if err != nil {
		if errors.Is(err, network.ErrInvalidTarget) {
			writeError(w, http.StatusBadRequest, "invalid network diagnostic target")
			return
		}
		// Never serialize raw resolver, URL, proxy, dial, or transport errors.
		writeError(w, http.StatusBadGateway, "network diagnostic failed")
		return
	}
	writeJSON(w, http.StatusOK, networkDiagnosticResultResponse{
		Target:      req.Target,
		LatencyMS:   boundedNetworkDiagnosticLatency(result.LatencyMS),
		StatusClass: coarseNetworkDiagnosticStatus(result.StatusClass),
	})
}

func (s *Server) networkDiagnosticsRunner() networkDiagnosticsRunner {
	stateValue, _ := serverNetworkDiagnosticsStates.LoadOrStore(s, &serverNetworkDiagnosticsState{})
	state := stateValue.(*serverNetworkDiagnosticsState)
	state.once.Do(func() {
		state.runner = network.NewDiagnostics(network.WithDiagnosticTimeout(networkDiagnosticTimeout))
	})
	return state.runner
}

func isFixedNetworkDiagnosticTarget(target network.Target) bool {
	switch target {
	case network.TargetOpenAIAPI,
		network.TargetAnthropicAPI,
		network.TargetTelegramAPI,
		network.TargetPublicInternet,
		network.TargetLocalCLIProxyAPI:
		return true
	default:
		return false
	}
}

func coarseNetworkDiagnosticStatus(status network.StatusClass) network.StatusClass {
	switch status {
	case network.StatusClassInformational,
		network.StatusClassSuccess,
		network.StatusClassRedirect,
		network.StatusClassClientError,
		network.StatusClassServerError,
		network.StatusClassInvalid,
		network.StatusClassPolicyDenied,
		network.StatusClassTimeout,
		network.StatusClassNetworkError:
		return status
	case network.StatusClassProxyError:
		// Proxy discovery is an implementation detail of one fixed policy.
		return network.StatusClassNetworkError
	default:
		return network.StatusClassNetworkError
	}
}

func boundedNetworkDiagnosticLatency(latencyMS int64) int64 {
	if latencyMS < 0 {
		return 0
	}
	const maximumReportedLatencyMS = int64(3 * time.Second / time.Millisecond)
	if latencyMS > maximumReportedLatencyMS {
		return maximumReportedLatencyMS
	}
	return latencyMS
}
