package network

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func TestExplicitTransportProxyPolicies(t *testing.T) {
	proxyCalls := 0
	proxy := func(*http.Request) (*url.URL, error) {
		proxyCalls++
		return url.Parse("http://user:password@proxy.example:8080")
	}
	request, err := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}

	environment := NewEnvironmentProxyTransport(WithEnvironmentProxy(proxy))
	proxyURL, err := environment.Proxy(request)
	if err != nil || proxyURL == nil || proxyCalls != 1 {
		t.Fatalf("environment proxy not selected: url=%v err=%v calls=%d", proxyURL, err, proxyCalls)
	}

	public := NewPublicDirectTransport(WithEnvironmentProxy(proxy))
	privateLAN := NewPrivateLANDirectTransport(WithEnvironmentProxy(proxy))
	if public.Proxy != nil || privateLAN.Proxy != nil {
		t.Fatal("direct transports must disable proxies")
	}
	if proxyCalls != 1 {
		t.Fatalf("direct transport unexpectedly consulted proxy: %d", proxyCalls)
	}
}

func TestEnvironmentProxyErrorsAreRedacted(t *testing.T) {
	secret := "http://user:password@proxy.example/?token=secret"
	transport := NewEnvironmentProxyTransport(WithEnvironmentProxy(func(*http.Request) (*url.URL, error) {
		return nil, errors.New(secret)
	}))
	request, err := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = transport.Proxy(request)
	if !errors.Is(err, ErrProxyConfiguration) {
		t.Fatalf("expected proxy configuration error, got %v", err)
	}
	assertRedacted(t, err.Error(), "user", "password", "token=secret", "proxy.example")
}

func TestPublicDirectAddressBoundaries(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "public.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		case "mixed.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}, {IP: net.ParseIP("10.0.0.2")}}, nil
		case "private.example":
			return []net.IPAddr{{IP: net.ParseIP("192.168.1.2")}}, nil
		default:
			return nil, errors.New("resolver detail must not escape")
		}
	})

	tests := []struct {
		name    string
		rawURL  string
		allowed bool
	}{
		{name: "public literal", rawURL: "https://8.8.8.8/", allowed: true},
		{name: "public DNS", rawURL: "https://public.example/", allowed: true},
		{name: "private", rawURL: "http://10.0.0.1/"},
		{name: "loopback", rawURL: "http://127.0.0.1/"},
		{name: "link local", rawURL: "http://169.254.1.1/"},
		{name: "metadata link local", rawURL: "http://169.254.169.254/latest/meta-data/"},
		{name: "metadata shared range", rawURL: "http://100.100.100.200/"},
		{name: "metadata hostname", rawURL: "http://metadata.google.internal/"},
		{name: "local name", rawURL: "http://printer.local/"},
		{name: "mixed rebinding answer", rawURL: "https://mixed.example/"},
		{name: "private DNS", rawURL: "https://private.example/"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parsed, err := url.Parse(test.rawURL)
			if err != nil {
				t.Fatal(err)
			}
			err = ValidateURL(context.Background(), PolicyPublicDirect, parsed, WithResolver(resolver))
			if test.allowed && err != nil {
				t.Fatalf("expected destination allowed, got %v", err)
			}
			if !test.allowed && !errors.Is(err, ErrDestinationDenied) {
				t.Fatalf("expected destination denial, got %v", err)
			}
		})
	}
}

func TestPrivateLANDirectAddressBoundaries(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "home.local", "lan.example":
			return []net.IPAddr{{IP: net.ParseIP("192.168.1.20")}}, nil
		case "public.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		default:
			return nil, errors.New("not found")
		}
	})

	allowed := []string{
		"http://127.0.0.1:8080/",
		"http://10.0.0.1/",
		"http://172.16.0.1/",
		"http://192.168.1.1/",
		"http://169.254.1.1/",
		"http://[::1]/",
		"http://[fd00::1]/",
		"http://[fe80::1%25en0]/",
		"http://home.local/",
		"http://lan.example/",
	}
	for _, raw := range allowed {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateURL(context.Background(), PolicyPrivateLANDirect, parsed, WithResolver(resolver)); err != nil {
			t.Errorf("expected %q allowed, got %v", raw, err)
		}
	}

	denied := []string{
		"https://8.8.8.8/",
		"https://public.example/",
		"http://169.254.169.254/",
		"http://metadata.google.internal/",
	}
	for _, raw := range denied {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateURL(context.Background(), PolicyPrivateLANDirect, parsed, WithResolver(resolver)); !errors.Is(err, ErrDestinationDenied) {
			t.Errorf("expected %q denied, got %v", raw, err)
		}
	}
}

func TestPublicDirectPinsValidatedIPAndRejectsRebinding(t *testing.T) {
	lookup := 0
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host != "rebind.example" {
			t.Fatalf("unexpected host %q", host)
		}
		lookup++
		if lookup == 1 {
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})
	dialCalls := 0
	var dialed string
	transport := NewPublicDirectTransport(
		WithResolver(resolver),
		WithDialContext(func(_ context.Context, _ string, address string) (net.Conn, error) {
			dialCalls++
			dialed = address
			return nil, errors.New("dial detail with token=secret")
		}),
	)

	_, firstErr := transport.DialContext(context.Background(), "tcp", "rebind.example:443")
	if !errors.Is(firstErr, ErrConnectionFailed) || dialed != "8.8.8.8:443" {
		t.Fatalf("expected pinned public IP and redacted dial error, address=%q err=%v", dialed, firstErr)
	}
	assertRedacted(t, firstErr.Error(), "token=secret", "rebind.example", "8.8.8.8")

	_, secondErr := transport.DialContext(context.Background(), "tcp", "rebind.example:443")
	if !errors.Is(secondErr, ErrDestinationDenied) {
		t.Fatalf("expected rebound private answer denied, got %v", secondErr)
	}
	if dialCalls != 1 {
		t.Fatalf("rebound address reached dialer: %d calls", dialCalls)
	}
}

func TestPrivateLANDirectPinsResolvedLocalIP(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host != "home.local" {
			t.Fatalf("unexpected host %q", host)
		}
		return []net.IPAddr{{IP: net.ParseIP("192.168.4.5")}}, nil
	})
	var dialed string
	transport := NewPrivateLANDirectTransport(
		WithResolver(resolver),
		WithDialContext(func(_ context.Context, _ string, address string) (net.Conn, error) {
			dialed = address
			return nil, errors.New("raw dial failure")
		}),
	)
	_, err := transport.DialContext(context.Background(), "tcp", "home.local:8123")
	if !errors.Is(err, ErrConnectionFailed) || dialed != "192.168.4.5:8123" {
		t.Fatalf("expected pinned LAN IP, address=%q err=%v", dialed, err)
	}
}

func TestRedirectPolicyRevalidatesEveryHop(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "one.example", "two.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		case "secret.internal":
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.8")}}, nil
		default:
			return nil, errors.New("unexpected")
		}
	})
	check := RedirectPolicy(PolicyPublicDirect, WithResolver(resolver), WithRedirectLimit(2))
	first := mustRequest(t, "https://one.example/start")
	second := mustRequest(t, "https://two.example/next")
	blocked := mustRequest(t, "http://user:password@secret.internal/admin?token=secret")

	if err := check(second, []*http.Request{first}); err != nil {
		t.Fatalf("expected public redirect allowed, got %v", err)
	}
	if err := check(blocked, []*http.Request{first, second}); !errors.Is(err, ErrRedirectLimit) {
		t.Fatalf("expected redirect bound before target details, got %v", err)
	}

	check = RedirectPolicy(PolicyPublicDirect, WithResolver(resolver), WithRedirectLimit(3))
	err := check(blocked, []*http.Request{first, second})
	if !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("expected credential-bearing redirect rejected, got %v", err)
	}
	assertRedacted(t, err.Error(), "user", "password", "secret.internal", "token=secret")
}

func TestResolverErrorsAreRedacted(t *testing.T) {
	resolver := resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return nil, errors.New("lookup https://user:password@dns.example/path?token=secret failed")
	})
	parsed, err := url.Parse("https://customer-secret.example/path?api_key=hidden")
	if err != nil {
		t.Fatal(err)
	}
	err = ValidateURL(context.Background(), PolicyPublicDirect, parsed, WithResolver(resolver))
	if !errors.Is(err, ErrNameResolution) {
		t.Fatalf("expected redacted resolution error, got %v", err)
	}
	assertRedacted(t, err.Error(), "customer-secret", "user", "password", "token=secret", "api_key")
}

func mustRequest(t *testing.T, raw string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return request
}

func TestProviderBaseURLPolicyAllowsOnlyPublicHTTPSOrLoopback(t *testing.T) {
	resolver := resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "public.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		case "private.example":
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.8")}}, nil
		case "localhost":
			return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}, {IP: net.ParseIP("::1")}}, nil
		default:
			return nil, errors.New("unexpected resolver target")
		}
	})
	tests := []struct {
		name    string
		rawURL  string
		allowed bool
	}{
		{name: "public https", rawURL: "https://public.example/v1", allowed: true},
		{name: "loopback http", rawURL: "http://localhost:8080/v1", allowed: true},
		{name: "loopback https", rawURL: "https://127.0.0.1:8443/v1", allowed: true},
		{name: "public http", rawURL: "http://public.example/v1"},
		{name: "private dns", rawURL: "https://private.example/v1"},
		{name: "link local", rawURL: "http://169.254.10.10/v1"},
		{name: "metadata", rawURL: "http://169.254.169.254/latest/meta-data"},
		{name: "metadata hostname", rawURL: "https://metadata.google.internal/v1"},
		{name: "userinfo", rawURL: "https://user:password@public.example/v1"},
		{name: "fragment", rawURL: "https://public.example/v1#token=secret"},
		{name: "query", rawURL: "https://public.example/v1?token=secret"},
		{name: "non http", rawURL: "file:///tmp/provider"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateProviderBaseURL(context.Background(), test.rawURL, WithResolver(resolver))
			if test.allowed && err != nil {
				t.Fatalf("expected %q allowed, got %v", test.rawURL, err)
			}
			if !test.allowed && err == nil {
				t.Fatalf("expected %q rejected", test.rawURL)
			}
			if err != nil {
				assertRedacted(t, err.Error(), "user", "password", "token=secret", "private.example")
			}
		})
	}
}

func TestProviderHTTPClientValidatesThenRejectsRedirects(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
	}))
	defer server.Close()
	client := NewProviderHTTPClient(2 * time.Second)
	response, err := client.Get(server.URL + "/models")
	if response != nil {
		response.Body.Close()
	}
	if !errors.Is(err, ErrDestinationDenied) {
		t.Fatalf("metadata redirect must be rejected by validated policy: %v", err)
	}
	if requests != 1 {
		t.Fatalf("redirect target must not be requested, got %d source requests", requests)
	}

	requests = 0
	server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Redirect(w, r, server.URL+"/next", http.StatusFound)
	})
	response, err = client.Get(server.URL + "/models")
	if response != nil {
		response.Body.Close()
	}
	if !errors.Is(err, ErrRedirectDenied) {
		t.Fatalf("validated provider redirect must still be refused: %v", err)
	}
	if requests != 1 {
		t.Fatalf("provider redirect was followed despite rejection: %d", requests)
	}
}

func TestConfiguredProviderHTTPClientAppliesProxyCredentialsAndHeaders(t *testing.T) {
	var calls int
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if got := r.Header.Get("Proxy-Authorization"); got != "Basic "+base64.StdEncoding.EncodeToString([]byte("proxy-user:proxy-pass")) {
			t.Fatalf("unexpected proxy authorization %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "Autoto Provider Test/1.0" {
			t.Fatalf("unexpected user agent %q", got)
		}
		if got := r.Header.Get("X-Tenant"); got != "tenant-secret" {
			t.Fatalf("unexpected custom header %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer configured-override" {
			t.Fatalf("configured header did not override request default: %q", got)
		}
		if r.URL.String() != "http://127.0.0.1:65535/v1/models" {
			t.Fatalf("unexpected proxied target %q", r.URL.String())
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer proxy.Close()

	client, err := NewConfiguredProviderHTTPClient(2*time.Second, ProviderHTTPConfig{
		ProxyURL:      proxy.URL,
		ProxyUsername: "proxy-user",
		ProxyPassword: "proxy-pass",
		UserAgent:     "Autoto Provider Test/1.0",
		Headers: http.Header{
			"X-Tenant":      []string{"tenant-secret"},
			"Authorization": []string{"Bearer configured-override"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:65535/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer sdk-default")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent || calls != 1 {
		t.Fatalf("unexpected proxy result: status=%d calls=%d", response.StatusCode, calls)
	}
}

func TestConfiguredProviderHTTPClientScopesTLSVerification(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	strict, err := NewConfiguredProviderHTTPClient(2*time.Second, ProviderHTTPConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if response, err := strict.Get(server.URL); err == nil {
		response.Body.Close()
		t.Fatal("strict provider client accepted an untrusted certificate")
	}

	insecure, err := NewConfiguredProviderHTTPClient(2*time.Second, ProviderHTTPConfig{InsecureSkipTLSVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	response, err := insecure.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected insecure TLS status %d", response.StatusCode)
	}
}

func assertRedacted(t *testing.T, value string, forbidden ...string) {
	t.Helper()
	for _, item := range forbidden {
		if strings.Contains(value, item) {
			t.Fatalf("value %q leaked %q", value, item)
		}
	}
}
