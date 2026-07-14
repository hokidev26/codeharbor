package network

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type doerFunc func(*http.Request) (*http.Response, error)

func (fn doerFunc) Do(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestDiagnosticsReturnsOnlyBoundedSafeFields(t *testing.T) {
	start := time.Unix(100, 0)
	clockCalls := 0
	clock := func() time.Time {
		clockCalls++
		if clockCalls == 1 {
			return start
		}
		return start.Add(37 * time.Millisecond)
	}
	cfg := applyOptions(
		WithEnvironmentProxy(func(*http.Request) (*url.URL, error) {
			return url.Parse("http://proxy-user:proxy-password@proxy.internal:8080")
		}),
		withClock(clock),
	)
	targets := map[Target]diagnosticTarget{
		TargetOpenAIAPI: {
			policy: PolicyEnvironmentProxy,
			url:    mustDiagnosticURL("https://service.example/health?token=secret"),
		},
	}
	clients := map[Policy]httpDoer{
		PolicyEnvironmentProxy: doerFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.Query().Get("token") != "secret" {
				t.Fatal("test target was not used internally")
			}
			return &http.Response{
				StatusCode: http.StatusNoContent,
				Body:       io.NopCloser(strings.NewReader("ignored")),
				Request:    request,
			}, nil
		}),
	}
	diagnostics := newDiagnostics(targets, clients, cfg)

	result, err := diagnostics.Run(context.Background(), TargetOpenAIAPI)
	if err != nil {
		t.Fatal(err)
	}
	if result.Policy != PolicyEnvironmentProxy || result.StatusClass != StatusClassSuccess || result.LatencyMS != 37 || !result.ProxyConfigured {
		t.Fatalf("unexpected result: %+v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	assertRedacted(t, string(encoded), "service.example", "token", "secret", "proxy.internal", "proxy-user", "proxy-password", "http://", "https://")
}

func TestDiagnosticsCollapsesRawNetworkErrors(t *testing.T) {
	cfg := applyOptions(withClock(sequenceClock(time.Unix(200, 0), time.Unix(200, int64(12*time.Millisecond)))))
	targets := map[Target]diagnosticTarget{
		TargetPublicInternet: {
			policy: PolicyPublicDirect,
			url:    mustDiagnosticURL("https://secret-host.example/path?api_key=hidden"),
		},
	}
	clients := map[Policy]httpDoer{
		PolicyPublicDirect: doerFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("dial proxy-user:proxy-password@10.0.0.1 token=secret")
		}),
	}
	diagnostics := newDiagnostics(targets, clients, cfg)

	result, err := diagnostics.Run(context.Background(), TargetPublicInternet)
	if err != nil {
		t.Fatal(err)
	}
	if result.StatusClass != StatusClassNetworkError || result.LatencyMS != 12 || result.ProxyConfigured {
		t.Fatalf("unexpected result: %+v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	assertRedacted(t, string(encoded), "secret-host", "api_key", "hidden", "proxy-user", "proxy-password", "10.0.0.1", "token=secret")
}

func TestDiagnosticsRejectsUnknownTargetWithoutRequest(t *testing.T) {
	called := false
	cfg := applyOptions()
	diagnostics := newDiagnostics(
		map[Target]diagnosticTarget{
			TargetPublicInternet: {policy: PolicyPublicDirect, url: mustDiagnosticURL("https://example.com/")},
		},
		map[Policy]httpDoer{
			PolicyPublicDirect: doerFunc(func(*http.Request) (*http.Response, error) {
				called = true
				return nil, nil
			}),
		},
		cfg,
	)

	_, err := diagnostics.Run(context.Background(), Target("https://attacker.example/?token=secret"))
	if !errors.Is(err, ErrInvalidTarget) {
		t.Fatalf("expected invalid target, got %v", err)
	}
	if called {
		t.Fatal("unknown target triggered an outbound request")
	}
	assertRedacted(t, err.Error(), "attacker", "token=secret", "https://")
}

func TestDiagnosticsProxyFailureIsBooleanAndClassOnly(t *testing.T) {
	called := false
	cfg := applyOptions(
		WithEnvironmentProxy(func(*http.Request) (*url.URL, error) {
			return nil, errors.New("http://user:password@proxy.example/?token=secret")
		}),
		withClock(sequenceClock(time.Unix(300, 0), time.Unix(300, int64(5*time.Millisecond)))),
	)
	diagnostics := newDiagnostics(
		map[Target]diagnosticTarget{
			TargetTelegramAPI: {policy: PolicyEnvironmentProxy, url: mustDiagnosticURL("https://api.telegram.org/")},
		},
		map[Policy]httpDoer{
			PolicyEnvironmentProxy: doerFunc(func(*http.Request) (*http.Response, error) {
				called = true
				return nil, nil
			}),
		},
		cfg,
	)

	result, err := diagnostics.Run(context.Background(), TargetTelegramAPI)
	if err != nil {
		t.Fatal(err)
	}
	if result.StatusClass != StatusClassProxyError || result.ProxyConfigured || result.LatencyMS != 5 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if called {
		t.Fatal("request ran with invalid proxy configuration")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	assertRedacted(t, string(encoded), "proxy.example", "user", "password", "token=secret")
}

func TestHTTPStatusClasses(t *testing.T) {
	tests := map[int]StatusClass{
		99:  StatusClassInvalid,
		100: StatusClassInformational,
		204: StatusClassSuccess,
		302: StatusClassRedirect,
		404: StatusClassClientError,
		503: StatusClassServerError,
		600: StatusClassInvalid,
	}
	for status, want := range tests {
		if got := httpStatusClass(status); got != want {
			t.Errorf("status %d: got %q want %q", status, got, want)
		}
	}
}

func TestBuiltinDiagnosticsExposeClosedTargetList(t *testing.T) {
	diagnostics := NewDiagnostics()
	targets := diagnostics.Targets()
	want := []Target{
		TargetOpenAIAPI,
		TargetAnthropicAPI,
		TargetTelegramAPI,
		TargetPublicInternet,
		TargetLocalCLIProxyAPI,
	}
	if len(targets) != len(want) {
		t.Fatalf("got targets %v, want %v", targets, want)
	}
	for index := range want {
		if targets[index] != want[index] {
			t.Fatalf("got targets %v, want %v", targets, want)
		}
	}
}

func sequenceClock(times ...time.Time) func() time.Time {
	index := 0
	return func() time.Time {
		if len(times) == 0 {
			return time.Time{}
		}
		if index >= len(times) {
			return times[len(times)-1]
		}
		value := times[index]
		index++
		return value
	}
}
