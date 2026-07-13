package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestMCPServersCRUDAndToolDiscovery(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{}, store, nil, nil)
	routes := app.Routes()

	payload := map[string]any{
		"name": "Fake MCP", "transport": "stdio", "command": os.Args[0],
		"args": []string{"-test.run=TestMCPServerFakeProcess"},
		"env":  map[string]string{"AUTOTO_MCP_SERVER_FAKE": "1", "TOKEN": "secret"},
	}
	body, _ := json.Marshal(payload)
	recorder := httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/mcp/servers", bytes.NewReader(body)))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var created mcpServerResponse
	if err := json.NewDecoder(recorder.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || !created.Enabled || strings.Contains(recorder.Body.String(), "secret") {
		t.Fatalf("unexpected create response: %+v body=%s", created, recorder.Body.String())
	}
	if len(created.EnvKeys) != 2 || created.EnvKeys[0] != "AUTOTO_MCP_SERVER_FAKE" || created.EnvKeys[1] != "TOKEN" {
		t.Fatalf("expected sorted env keys, got %+v", created.EnvKeys)
	}

	recorder = httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/mcp/servers/"+created.ID+"/tools", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected tools 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var tools mcpToolsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&tools); err != nil {
		t.Fatal(err)
	}
	if tools.Count != 1 || tools.Tools[0].Name != "echo" {
		t.Fatalf("unexpected tools discovery: %+v", tools)
	}

	patch, _ := json.Marshal(map[string]any{"enabled": false})
	recorder = httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodPatch, "/api/mcp/servers/"+created.ID, bytes.NewReader(patch)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected patch 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	patched, err := store.GetMCPServer(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if patched.Env["TOKEN"] != "secret" {
		t.Fatalf("expected patch without env to preserve stored env, got %+v", patched.Env)
	}

	recorder = httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/mcp/servers/"+created.ID+"/tools", nil))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected disabled discovery 409, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	routes.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/api/mcp/servers/"+created.ID, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected delete 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestMCPServerFakeProcess(t *testing.T) {
	if os.Getenv("AUTOTO_MCP_SERVER_FAKE") != "1" {
		return
	}
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := decoder.Decode(&request); err != nil {
			return
		}
		if len(request.ID) == 0 {
			continue
		}
		response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
		switch request.Method {
		case "initialize":
			response["result"] = map[string]any{"protocolVersion": "2024-11-05", "capabilities": map[string]any{"tools": map[string]any{}}}
		case "tools/list":
			response["result"] = map[string]any{"tools": []map[string]any{{"name": "echo", "description": "Echo a greeting", "inputSchema": map[string]any{"type": "object"}}}}
		default:
			response["error"] = map[string]any{"code": -32601, "message": "method not found"}
		}
		_ = encoder.Encode(response)
	}
}
