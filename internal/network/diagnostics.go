package network

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"
)

// Target is a closed, server-owned diagnostic target identifier. Run accepts no
// URL input, so callers cannot turn diagnostics into a generic request proxy.
type Target string

const (
	TargetOpenAIAPI        Target = "openai_api"
	TargetAnthropicAPI     Target = "anthropic_api"
	TargetTelegramAPI      Target = "telegram_api"
	TargetPublicInternet   Target = "public_internet"
	TargetLocalCLIProxyAPI Target = "local_cliproxyapi"
)

// StatusClass intentionally reports only a coarse class. It never contains an
// HTTP status text, URL, query, proxy address, credential, or raw error.
type StatusClass string

const (
	StatusClassInformational StatusClass = "1xx"
	StatusClassSuccess       StatusClass = "2xx"
	StatusClassRedirect      StatusClass = "3xx"
	StatusClassClientError   StatusClass = "4xx"
	StatusClassServerError   StatusClass = "5xx"
	StatusClassInvalid       StatusClass = "invalid_status"
	StatusClassPolicyDenied  StatusClass = "policy_denied"
	StatusClassProxyError    StatusClass = "proxy_error"
	StatusClassTimeout       StatusClass = "timeout"
	StatusClassNetworkError  StatusClass = "network_error"
)

// DiagnosticResult is deliberately bounded and safe to serialize.
type DiagnosticResult struct {
	Target          Target      `json:"target"`
	Policy          Policy      `json:"policy"`
	LatencyMS       int64       `json:"latencyMs"`
	StatusClass     StatusClass `json:"statusClass"`
	ProxyConfigured bool        `json:"proxyConfigured"`
}

type diagnosticTarget struct {
	policy Policy
	url    *url.URL
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// Diagnostics executes fixed server-side probes using the same policy clients
// that production callers can construct. It stores no caller-provided URL.
type Diagnostics struct {
	targets map[Target]diagnosticTarget
	clients map[Policy]httpDoer
	proxy   ProxyFunc
	now     func() time.Time
}

var builtinDiagnosticTargets = map[Target]diagnosticTarget{
	TargetOpenAIAPI: {
		policy: PolicyEnvironmentProxy,
		url:    mustDiagnosticURL("https://api.openai.com/v1/models"),
	},
	TargetAnthropicAPI: {
		policy: PolicyEnvironmentProxy,
		url:    mustDiagnosticURL("https://api.anthropic.com/v1/models"),
	},
	TargetTelegramAPI: {
		policy: PolicyEnvironmentProxy,
		url:    mustDiagnosticURL("https://api.telegram.org/"),
	},
	TargetPublicInternet: {
		policy: PolicyPublicDirect,
		url:    mustDiagnosticURL("https://example.com/"),
	},
	TargetLocalCLIProxyAPI: {
		policy: PolicyPrivateLANDirect,
		url:    mustDiagnosticURL("http://127.0.0.1:8317/v1/models"),
	},
}

// NewDiagnostics constructs diagnostics for the fixed Target enumeration.
func NewDiagnostics(opts ...Option) *Diagnostics {
	cfg := applyOptions(opts...)
	clients := make(map[Policy]httpDoer, 3)
	for _, policy := range []Policy{PolicyEnvironmentProxy, PolicyPublicDirect, PolicyPrivateLANDirect} {
		client, err := newHTTPClient(policy, cfg)
		if err == nil {
			clients[policy] = client
		}
	}
	return newDiagnostics(builtinDiagnosticTargets, clients, cfg)
}

func newDiagnostics(targets map[Target]diagnosticTarget, clients map[Policy]httpDoer, cfg options) *Diagnostics {
	targetCopy := make(map[Target]diagnosticTarget, len(targets))
	for target, definition := range targets {
		definition.url = cloneURL(definition.url)
		targetCopy[target] = definition
	}
	clientCopy := make(map[Policy]httpDoer, len(clients))
	for policy, client := range clients {
		clientCopy[policy] = client
	}
	return &Diagnostics{
		targets: targetCopy,
		clients: clientCopy,
		proxy:   cfg.proxy,
		now:     cfg.now,
	}
}

// Targets returns the closed set of accepted diagnostic identifiers.
func (d *Diagnostics) Targets() []Target {
	ordered := []Target{
		TargetOpenAIAPI,
		TargetAnthropicAPI,
		TargetTelegramAPI,
		TargetPublicInternet,
		TargetLocalCLIProxyAPI,
	}
	out := make([]Target, 0, len(ordered))
	for _, target := range ordered {
		if _, ok := d.targets[target]; ok {
			out = append(out, target)
		}
	}
	return out
}

// Run probes one enumerated Target. Reachability failures are represented by a
// coarse StatusClass instead of an error string. The only returned error is the
// stable ErrInvalidTarget for an unknown enumeration value.
func (d *Diagnostics) Run(ctx context.Context, target Target) (DiagnosticResult, error) {
	definition, ok := d.targets[target]
	if !ok || definition.url == nil || !validPolicy(definition.policy) {
		return DiagnosticResult{}, ErrInvalidTarget
	}
	result := DiagnosticResult{
		Target: target,
		Policy: definition.policy,
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodHead, definition.url.String(), nil)
	if err != nil {
		result.StatusClass = StatusClassPolicyDenied
		return result, nil
	}

	started := d.now()
	if definition.policy == PolicyEnvironmentProxy {
		proxyURL, proxyErr := redactingProxy(d.proxy)(request)
		if proxyErr != nil {
			result.LatencyMS = elapsedMilliseconds(started, d.now())
			result.StatusClass = StatusClassProxyError
			return result, nil
		}
		result.ProxyConfigured = proxyURL != nil
	}

	client := d.clients[definition.policy]
	if client == nil {
		result.LatencyMS = elapsedMilliseconds(started, d.now())
		result.StatusClass = StatusClassNetworkError
		return result, nil
	}
	response, requestErr := client.Do(request)
	result.LatencyMS = elapsedMilliseconds(started, d.now())
	if requestErr != nil {
		result.StatusClass = diagnosticErrorClass(requestErr)
		return result, nil
	}
	if response == nil {
		result.StatusClass = StatusClassNetworkError
		return result, nil
	}
	if response.Body != nil {
		_ = response.Body.Close()
	}
	result.StatusClass = httpStatusClass(response.StatusCode)
	return result, nil
}

func diagnosticErrorClass(err error) StatusClass {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return StatusClassTimeout
	case errors.Is(err, ErrDestinationDenied), errors.Is(err, ErrInvalidURL), errors.Is(err, ErrInvalidPolicy), errors.Is(err, ErrRedirectLimit):
		return StatusClassPolicyDenied
	case errors.Is(err, ErrProxyConfiguration):
		return StatusClassProxyError
	default:
		return StatusClassNetworkError
	}
}

func httpStatusClass(status int) StatusClass {
	switch status / 100 {
	case 1:
		return StatusClassInformational
	case 2:
		return StatusClassSuccess
	case 3:
		return StatusClassRedirect
	case 4:
		return StatusClassClientError
	case 5:
		return StatusClassServerError
	default:
		return StatusClassInvalid
	}
}

func elapsedMilliseconds(start, end time.Time) int64 {
	if end.Before(start) {
		return 0
	}
	return end.Sub(start).Milliseconds()
}

func mustDiagnosticURL(raw string) *url.URL {
	parsed, err := url.Parse(raw)
	if err != nil {
		panic("network: invalid built-in diagnostic target")
	}
	return parsed
}

func cloneURL(source *url.URL) *url.URL {
	if source == nil {
		return nil
	}
	clone := *source
	if source.User != nil {
		user := *source.User
		clone.User = &user
	}
	return &clone
}
