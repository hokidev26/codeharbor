package devices

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"autoto/internal/integrations"
)

const testAccessToken = "test-long-lived-access-token-never-leak"

func TestNewClientValidatesConnectionAndKeepsTokenPrivate(t *testing.T) {
	t.Parallel()

	invalidConnections := []integrations.ResolvedConnection{
		{Kind: "homeassistant", Endpoint: "https://ha.example.test", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "/relative", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "ftp://ha.example.test", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "http:/missing-host", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://user:pass@ha.example.test", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test?token=bad", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test?", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test#fragment", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test#", Secrets: map[string]string{"accessToken": testAccessToken}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test", Secrets: nil},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test", Secrets: map[string]string{"accessToken": ""}},
		{Kind: HomeAssistantKind, Endpoint: "https://ha.example.test", Secrets: map[string]string{"accessToken": " token-with-spaces "}},
	}
	for _, connection := range invalidConnections {
		if client, err := NewClient(connection, &http.Client{}); err == nil || client != nil {
			t.Errorf("NewClient(%q) = (%v, %v), want failure", connection.Endpoint, client, err)
		} else if strings.Contains(err.Error(), testAccessToken) {
			t.Fatalf("connection error leaked token: %v", err)
		}
	}
	if client, err := NewClient(validConnection("https://ha.example.test"), nil); err == nil || client != nil {
		t.Fatalf("NewClient with nil HTTP client = (%v, %v), want failure", client, err)
	}

	client, err := NewClient(validConnection("https://ha.example.test/base"), &http.Client{})
	if err != nil {
		t.Fatalf("NewClient(valid) error = %v", err)
	}
	encoded, err := json.Marshal(client)
	if err != nil {
		t.Fatalf("json.Marshal(client) error = %v", err)
	}
	if !json.Valid(encoded) || strings.Contains(string(encoded), testAccessToken) {
		t.Fatalf("client JSON leaked token or is invalid: %s", encoded)
	}
	formatted := fmt.Sprintf("%v %+v %#v | %v %+v %#v", client, client, client, *client, *client, *client)
	if strings.Contains(formatted, testAccessToken) {
		t.Fatalf("formatted client leaked token: %s", formatted)
	}

	transportClient, err := NewClient(validConnection("https://ha.example.test"), &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("transport exposed " + testAccessToken)
	})})
	if err != nil {
		t.Fatal(err)
	}
	_, err = transportClient.ListEntities(context.Background())
	if !errors.Is(err, ErrRequestFailed) || strings.Contains(err.Error(), testAccessToken) {
		t.Fatalf("transport error was not generic and secret-free: %v", err)
	}
}

func TestListEntitiesUsesStatesEndpointAndWhitelistsAttributes(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/ha/api/states" {
			t.Errorf("path = %s, want /ha/api/states", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+testAccessToken {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get("Accept"); got != "application/json" {
			t.Errorf("Accept = %q, want application/json", got)
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"entity_id": "light.kitchen",
				"state":     "on",
				"attributes": map[string]any{
					"friendly_name":       "Kitchen Light",
					"brightness":          127,
					"temperature":         22.5,
					"unit_of_measurement": "°C",
					"device_class":        "light",
					"assumed_state":       false,
					"entity_picture":      "/api/camera_proxy/camera.secret",
					"password":            "private-value",
					"accessToken":         testAccessToken,
					"nested":              map[string]any{"private": "value"},
				},
			},
			{
				"entity_id": "sensor.private",
				"state":     "prefix-" + testAccessToken,
				"attributes": map[string]any{
					"friendly_name": testAccessToken,
					"device_class":  "temperature",
				},
			},
			{"entity_id": "bad {{ template }}", "state": "on", "attributes": map[string]any{"friendly_name": "Bad"}},
		})
	}))
	defer server.Close()

	client := mustClient(t, server.URL+"/ha")
	entities, err := client.ListEntities(context.Background())
	if err != nil {
		t.Fatalf("ListEntities() error = %v", err)
	}
	if len(entities) != 2 {
		t.Fatalf("entity count = %d, want 2: %+v", len(entities), entities)
	}
	first := entities[0]
	if first.ID != "light.kitchen" || first.Name != "Kitchen Light" || first.Domain != "light" || first.State != "on" {
		t.Fatalf("unexpected first entity: %+v", first)
	}
	for _, key := range []string{"friendly_name", "brightness", "temperature", "unit_of_measurement", "device_class", "assumed_state"} {
		if _, ok := first.Attributes[key]; !ok {
			t.Errorf("whitelisted attribute %q missing: %+v", key, first.Attributes)
		}
	}
	for _, key := range []string{"entity_picture", "password", "accessToken", "nested"} {
		if _, ok := first.Attributes[key]; ok {
			t.Errorf("non-whitelisted attribute %q leaked: %+v", key, first.Attributes)
		}
	}
	second := entities[1]
	if second.Name != second.ID || second.State != "unknown" {
		t.Fatalf("token-bearing strings were not redacted: %+v", second)
	}
	encoded, err := json.Marshal(entities)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), testAccessToken) || strings.Contains(string(encoded), "private-value") || strings.Contains(string(encoded), "entity_picture") {
		t.Fatalf("public entity JSON leaked private data: %s", encoded)
	}
}

func TestListAndExecuteReturnGenericNon2xxErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream included "+testAccessToken, http.StatusUnauthorized)
	}))
	defer server.Close()
	client := mustClient(t, server.URL)

	if _, err := client.ListEntities(context.Background()); !errors.Is(err, ErrRemoteRejected) || strings.Contains(err.Error(), testAccessToken) {
		t.Fatalf("ListEntities non-2xx error = %v, want generic secret-free error", err)
	}
	canonical, err := CanonicalAction(Action{Domain: "switch", Service: "turn_off", Input: json.RawMessage(`{"entity_id":"switch.fan"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Execute(context.Background(), canonical); !errors.Is(err, ErrRemoteRejected) || strings.Contains(err.Error(), testAccessToken) {
		t.Fatalf("Execute non-2xx error = %v, want generic secret-free error", err)
	}
}

func TestExecuteRequiresCanonicalActionAndSendsExactRequest(t *testing.T) {
	t.Parallel()

	var requestCount atomic.Int32
	var reject atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount.Add(1)
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/ha/api/services/light/turn_on" {
			t.Errorf("path = %s, want service endpoint", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+testAccessToken {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if string(body) != `{"entity_id":"light.kitchen","brightness":64}` {
			t.Errorf("body = %s", body)
		}
		if reject.Load() {
			http.Error(w, "secret "+testAccessToken, http.StatusInternalServerError)
			return
		}
		_, _ = io.WriteString(w, `[]`)
	}))
	defer server.Close()
	client := mustClient(t, server.URL+"/ha")

	raw := Action{Domain: "light", Service: "turn_on", Input: json.RawMessage(`{"brightness":64,"entity_id":"light.kitchen"}`)}
	if err := client.Execute(context.Background(), raw); !errors.Is(err, ErrActionNotCanonical) {
		t.Fatalf("Execute(raw) error = %v, want non-canonical", err)
	}
	if requestCount.Load() != 0 {
		t.Fatal("non-canonical action reached Home Assistant")
	}

	canonical, err := client.CanonicalAction(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got := client.Risk(canonical); got != RiskMedium {
		t.Fatalf("Risk(canonical) = %q", got)
	}
	if err := client.Execute(context.Background(), canonical); err != nil {
		t.Fatalf("Execute(canonical) error = %v", err)
	}
	if requestCount.Load() != 1 {
		t.Fatalf("request count = %d, want 1", requestCount.Load())
	}

	mutated := canonical
	mutated.Input = append(json.RawMessage(nil), canonical.Input...)
	mutated.Input[0] = '['
	if err := client.Execute(context.Background(), mutated); !errors.Is(err, ErrActionNotCanonical) {
		t.Fatalf("Execute(mutated) error = %v, want non-canonical", err)
	}
	if requestCount.Load() != 1 {
		t.Fatal("mutated canonical action reached Home Assistant")
	}

	reject.Store(true)
	if err := client.Execute(context.Background(), canonical); !errors.Is(err, ErrRemoteRejected) || strings.Contains(err.Error(), testAccessToken) {
		t.Fatalf("Execute rejected error = %v, want generic secret-free error", err)
	}
}

func TestResponsesAreSizeBounded(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/states":
			_, _ = w.Write(bytes.Repeat([]byte("x"), MaxListResponseBytes+1))
		case "/api/services/switch/turn_on":
			_, _ = w.Write(bytes.Repeat([]byte("x"), MaxExecuteResponseBytes+1))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := mustClient(t, server.URL)

	if _, err := client.ListEntities(context.Background()); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("ListEntities oversized error = %v", err)
	}
	canonical, err := CanonicalAction(Action{Domain: "switch", Service: "turn_on", Input: json.RawMessage(`{"entity_id":"switch.fan"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Execute(context.Background(), canonical); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("Execute oversized error = %v", err)
	}
}

func TestRequestsAreTimeoutBounded(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(500 * time.Millisecond):
			_, _ = io.WriteString(w, `[]`)
		}
	}))
	defer server.Close()

	client, err := NewClient(validConnection(server.URL), &http.Client{Timeout: 30 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, err = client.ListEntities(context.Background())
	if !errors.Is(err, ErrRequestFailed) {
		t.Fatalf("ListEntities timeout error = %v, want request failed", err)
	}
	if elapsed := time.Since(started); elapsed > 400*time.Millisecond {
		t.Fatalf("request timeout took %s", elapsed)
	}
}

func validConnection(endpoint string) integrations.ResolvedConnection {
	return integrations.ResolvedConnection{
		Kind:     HomeAssistantKind,
		Endpoint: endpoint,
		Secrets:  map[string]string{"accessToken": testAccessToken},
	}
}

func mustClient(t *testing.T, endpoint string) *Client {
	t.Helper()
	client, err := NewClient(validConnection(endpoint), &http.Client{})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	return client
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
