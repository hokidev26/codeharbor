package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
)

type wsTestFrame struct {
	Type           string `json:"type"`
	Protocol       int    `json:"protocol"`
	StreamSession  string `json:"streamSession"`
	LatestSequence uint64 `json:"latestSequence"`
	Reason         string `json:"reason"`
	Sequence       uint64 `json:"sequence"`
	Text           string `json:"text"`
}

func TestAgentWSProtocol2ReplaysFromCursor(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	app, server, store, agent := newWSTestServer(t, ctx)
	defer store.Close()
	defer server.Close()

	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "one"})
	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "two"})
	bootstrap := app.hub.SubscribeProtocol(ctx, agentpkg.SubscribeOptions{AgentID: agent.ID})

	conn := dialWSTest(t, ctx, server.URL, app.localToken, url.Values{
		"id":            {agent.ID},
		"protocol":      {"2"},
		"streamSession": {bootstrap.StreamSession},
		"after":         {"1"},
	})
	defer conn.CloseNow()

	connected := readWSTestFrame(t, ctx, conn)
	if connected.Type != "connected" || connected.Protocol != agentpkg.ProtocolVersion || connected.StreamSession != bootstrap.StreamSession || connected.LatestSequence != 2 {
		t.Fatalf("unexpected connected frame: %+v", connected)
	}
	replay := readWSTestFrame(t, ctx, conn)
	if replay.Type != "agent.text" || replay.Text != "two" || replay.Protocol != agentpkg.ProtocolVersion || replay.StreamSession != bootstrap.StreamSession || replay.Sequence != 2 {
		t.Fatalf("unexpected replay frame: %+v", replay)
	}
}

func TestAgentWSProtocol2ResyncAndAgentValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	app, server, store, agent := newWSTestServer(t, ctx)
	defer store.Close()
	defer server.Close()

	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "one"})
	conn := dialWSTest(t, ctx, server.URL, app.localToken, url.Values{
		"id":            {agent.ID},
		"protocol":      {"2"},
		"streamSession": {"wrong-session"},
		"after":         {"1"},
	})
	frame := readWSTestFrame(t, ctx, conn)
	conn.CloseNow()
	if frame.Type != "resync_required" || frame.Protocol != agentpkg.ProtocolVersion || frame.Reason != string(agentpkg.ResyncSessionMismatch) || frame.StreamSession == "" {
		t.Fatalf("unexpected resync frame: %+v", frame)
	}

	query := url.Values{"id": {"missing-agent"}, "protocol": {"2"}, "token": {app.localToken}}
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/agent?" + query.Encode()
	_, response, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{server.URL}}})
	if err == nil {
		t.Fatal("expected unknown agent websocket dial to fail")
	}
	if response == nil || response.StatusCode != http.StatusNotFound {
		if response == nil {
			t.Fatal("expected unknown-agent HTTP response")
		}
		t.Fatalf("expected 404 for unknown agent, got %d", response.StatusCode)
	}
}

func TestAgentLiveSnapshotV2RouteReturnsAuthoritativeWatermark(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	app, server, store, agent := newWSTestServer(t, ctx)
	defer store.Close()
	defer server.Close()

	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "snapshot"})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v2/agents/"+agent.ID+"/live-snapshot", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(localTokenHeader, app.localToken)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.StatusCode)
	}
	var snapshot agentLiveSnapshotResponse
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Protocol != agentpkg.ProtocolVersion || snapshot.Agent.ID != agent.ID || snapshot.Stream.StreamSession == "" || snapshot.Stream.LatestSequence != 1 {
		t.Fatalf("unexpected live snapshot: %+v", snapshot)
	}
}

func TestAgentWSLegacyConnectionStaysRealtimeOnly(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	app, server, store, agent := newWSTestServer(t, ctx)
	defer store.Close()
	defer server.Close()

	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "before"})
	conn := dialWSTest(t, ctx, server.URL, app.localToken, url.Values{"id": {agent.ID}})
	defer conn.CloseNow()
	connected := readWSTestFrame(t, ctx, conn)
	if connected.Type != "connected" || connected.Protocol != 0 {
		t.Fatalf("unexpected legacy connected frame: %+v", connected)
	}

	app.hub.Publish(agentpkg.Event{Type: "agent.text", AgentID: agent.ID, Text: "after"})
	live := readWSTestFrame(t, ctx, conn)
	if live.Type != "agent.text" || live.Text != "after" || live.Sequence != 2 {
		t.Fatalf("expected only live legacy event, got %+v", live)
	}
}

func newWSTestServer(t *testing.T, ctx context.Context) (*Server, *httptest.Server, *db.Store, db.Agent) {
	t.Helper()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "ws-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, agent, err := store.CreateProject(ctx, "WebSocket", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	app := New(config.Config{}, store, nil, agentpkg.NewHub())
	return app, httptest.NewServer(app.Routes()), store, agent
}

func dialWSTest(t *testing.T, ctx context.Context, baseURL, token string, query url.Values) *websocket.Conn {
	t.Helper()
	query.Set("token", token)
	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/ws/agent?" + query.Encode()
	conn, response, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{baseURL}}})
	if err != nil {
		if response != nil {
			t.Fatalf("websocket dial failed with status %d: %v", response.StatusCode, err)
		}
		t.Fatalf("websocket dial failed: %v", err)
	}
	return conn
}

func readWSTestFrame(t *testing.T, ctx context.Context, conn *websocket.Conn) wsTestFrame {
	t.Helper()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var frame wsTestFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("decode websocket frame %s: %v", string(data), err)
	}
	return frame
}
