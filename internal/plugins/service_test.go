package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"autoto/internal/db"
	"autoto/internal/mcp"
	"autoto/internal/secrets"
	"autoto/internal/tools"
)

type resolverFunc func(context.Context, secrets.Ref) (string, error)

func (f resolverFunc) Resolve(ctx context.Context, ref secrets.Ref) (string, error) {
	return f(ctx, ref)
}

type fakeMCPClient struct {
	tools      []mcp.Tool
	initErr    error
	listErr    error
	callResult mcp.ToolCallResult
	callErr    error
	onCall     func()
}

func (f *fakeMCPClient) Initialize(context.Context) error { return f.initErr }
func (f *fakeMCPClient) ListTools(context.Context) ([]mcp.Tool, error) {
	return append([]mcp.Tool(nil), f.tools...), f.listErr
}
func (f *fakeMCPClient) CallTool(context.Context, string, json.RawMessage) (mcp.ToolCallResult, error) {
	if f.onCall != nil {
		f.onCall()
	}
	return f.callResult, f.callErr
}
func (f *fakeMCPClient) Close() error { return nil }

type recordingStarter struct {
	mu      sync.Mutex
	clients []*fakeMCPClient
	configs []mcp.StdioConfig
}

func (s *recordingStarter) start(_ context.Context, cfg mcp.StdioConfig) (MCPClient, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.configs = append(s.configs, cfg)
	if len(s.clients) == 0 {
		return nil, errors.New("no fake MCP client")
	}
	client := s.clients[0]
	s.clients = s.clients[1:]
	return client, nil
}

func TestServiceEnableDynamicToolSecurityLifecycle(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "plugins.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root := writePluginFixture(t, "demo", map[string]string{"MODE": "test"}, map[string]string{"TOKEN": "env:PLUGIN_TOKEN"})
	const secret = "resolved-plugin-secret"
	schema := json.RawMessage(`{"type":"object","properties":{"message":{"type":"string"}},"required":["message"],"additionalProperties":false,"$defs":{"tag":{"type":"string"}}}`)
	starter := &recordingStarter{clients: []*fakeMCPClient{
		{tools: []mcp.Tool{{Name: "echo", Description: "Echo text", InputSchema: schema}}},
		{callResult: mcp.ToolCallResult{Content: json.RawMessage(`[{"type":"text","text":"value=resolved-plugin-secret"}]`)}},
	}}
	service := NewService(store, resolverFunc(func(_ context.Context, ref secrets.Ref) (string, error) {
		if ref.Name != "PLUGIN_TOKEN" {
			return "", errors.New("unexpected ref")
		}
		return secret, nil
	}), WithMCPStarter(starter.start))

	installed, err := service.Install(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if installed.Enabled || installed.Status != "disabled" || installed.SecretRefs["TOKEN"] != "env:PLUGIN_TOKEN" {
		t.Fatalf("install must persist disabled references only: %+v", installed)
	}
	if _, err := service.Discover(ctx, installed.ID); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("disabled plugin discovery executed code: %v", err)
	}
	if len(starter.configs) != 0 {
		t.Fatalf("disabled plugin discovery started MCP: %+v", starter.configs)
	}
	enabled, err := service.Enable(ctx, installed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !enabled.Enabled || enabled.Status != "healthy" {
		t.Fatalf("unexpected enabled plugin: %+v", enabled)
	}
	if len(starter.configs) != 1 || !starter.configs[0].CleanEnv || starter.configs[0].Env["TOKEN"] != secret || starter.configs[0].Env["MODE"] != "test" {
		t.Fatalf("plugin MCP did not use isolated resolved environment: %+v", starter.configs)
	}
	if _, leaked := starter.configs[0].Env["AUTOTO_UNRELATED_PARENT_SECRET"]; leaked {
		t.Fatal("plugin config copied unrelated parent environment")
	}

	dynamic, err := service.ListTools(ctx, tools.ResolutionContext{AgentID: "agent-1", CWD: t.TempDir()})
	if err != nil || len(dynamic) != 1 {
		t.Fatalf("unexpected dynamic tools: %+v err=%v", dynamic, err)
	}
	adapter := dynamic[0]
	if adapter.Name() != "plugin__demo__echo" || adapter.Risk(nil) != tools.RiskExec {
		t.Fatalf("unexpected adapter identity/risk: %s %s", adapter.Name(), adapter.Risk(nil))
	}
	var gotSchema, wantSchema any
	if err := json.Unmarshal(adapter.Schema().(json.RawMessage), &gotSchema); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(schema, &wantSchema); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotSchema, wantSchema) {
		t.Fatalf("native schema was not preserved:\n got %v\nwant %v", gotSchema, wantSchema)
	}
	result, err := adapter.Execute(ctx, tools.Call{ID: "call-1", Name: adapter.Name(), Input: json.RawMessage(`{"message":"hi"}`)}, tools.Env{AgentID: "agent-1"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Output, secret) || !strings.Contains(result.Output, "[REDACTED]") {
		t.Fatalf("plugin output leaked resolved secret: %+v", result)
	}

	if _, err := service.Disable(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.Execute(ctx, tools.Call{Name: adapter.Name(), Input: json.RawMessage(`{}`)}, tools.Env{}); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("retained adapter did not fail closed after disable: %v", err)
	}
	if err := service.Uninstall(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.Execute(ctx, tools.Call{Name: adapter.Name(), Input: json.RawMessage(`{}`)}, tools.Env{}); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("retained adapter did not fail closed after uninstall: %v", err)
	}
}

func TestBoundPluginOutput(t *testing.T) {
	output, truncated := boundPluginOutput(strings.Repeat("x", 100), 24)
	if !truncated || len(output) > 24 || !strings.HasSuffix(output, "...[truncated]") {
		t.Fatalf("plugin output was not bounded: len=%d truncated=%v output=%q", len(output), truncated, output)
	}
}

func TestServiceEnableFailureStaysDisabledAndRejectsNameCollision(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "plugins.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root := writePluginFixture(t, "collision", nil, nil)
	starter := &recordingStarter{clients: []*fakeMCPClient{{tools: []mcp.Tool{
		{Name: "foo/bar", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "foo.bar", InputSchema: json.RawMessage(`{"type":"object"}`)},
	}}}}
	service := NewService(store, nil, WithMCPStarter(starter.start))
	installed, err := service.Install(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Enable(ctx, installed.ID); err == nil || !strings.Contains(err.Error(), "collision") {
		t.Fatalf("expected normalized name collision, got %v", err)
	}
	stored, err := store.GetPlugin(ctx, installed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Enabled || stored.Status != "error" {
		t.Fatalf("failed enable must remain disabled: %+v", stored)
	}
	storedTools, err := store.ListPluginTools(ctx, installed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(storedTools) != 0 {
		t.Fatalf("failed enable persisted partial tool snapshot: %+v", storedTools)
	}
}

func TestPluginAdapterRejectsRevisionChange(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "plugins.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root := writePluginFixture(t, "revision", nil, nil)
	starter := &recordingStarter{clients: []*fakeMCPClient{{tools: []mcp.Tool{{Name: "ping", InputSchema: json.RawMessage(`{"type":"object"}`)}}}}}
	service := NewService(store, nil, WithMCPStarter(starter.start))
	installed, err := service.Install(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Enable(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	listed, err := service.ListTools(ctx, tools.ResolutionContext{})
	if err != nil || len(listed) != 1 {
		t.Fatalf("list adapters: %+v %v", listed, err)
	}
	current, err := store.GetPlugin(ctx, installed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdatePluginStatus(ctx, current.ID, current.Status, true, db.Now(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := listed[0].Execute(ctx, tools.Call{Name: listed[0].Name(), Input: json.RawMessage(`{}`)}, tools.Env{}); err == nil || !strings.Contains(err.Error(), "revision changed") {
		t.Fatalf("stale adapter did not reject revision change: %v", err)
	}
}

func writePluginFixture(t *testing.T, slug string, env, refs map[string]string) string {
	t.Helper()
	root := t.TempDir()
	command := filepath.Join(root, "server")
	if err := os.WriteFile(command, []byte("fixture"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := map[string]any{
		"apiVersion": APIVersionV1Alpha1, "transport": TransportStdio,
		"slug": slug, "name": "Plugin " + slug, "version": "1.0.0", "command": "server",
		"env": env, "secretRefs": refs,
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ManifestFilename), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}
