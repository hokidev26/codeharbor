package agent

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

type dynamicTestTool struct {
	name   string
	schema json.RawMessage
	risk   tools.Risk
}

func (t dynamicTestTool) Name() string        { return t.name }
func (t dynamicTestTool) Description() string { return "dynamic plugin test tool" }
func (t dynamicTestTool) Schema() any         { return t.schema }
func (t dynamicTestTool) Risk(json.RawMessage) tools.Risk {
	return t.risk
}
func (t dynamicTestTool) Execute(context.Context, tools.Call, tools.Env) (tools.Result, error) {
	return tools.Result{Output: "dynamic"}, nil
}

type dynamicTestSource struct {
	mu        sync.Mutex
	tool      tools.Tool
	listCount int
}

func (s *dynamicTestSource) ListTools(context.Context, tools.ResolutionContext) ([]tools.Tool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listCount++
	return []tools.Tool{s.tool}, nil
}

func (s *dynamicTestSource) ResolveTool(_ context.Context, _ tools.ResolutionContext, name string) (tools.Tool, error) {
	if s.tool != nil && s.tool.Name() == name {
		return s.tool, nil
	}
	return nil, errors.New("tool not found")
}

func TestRunnerSnapshotsDynamicNativeSchemaOncePerRun(t *testing.T) {
	ctx := context.Background()
	store, agent := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, dbMessage(agent.ID, "schema")); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{{{Type: "text", Text: "done"}, {Type: "done", Done: true}}}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{MaxTurns: 1})
	schema := json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false,"$defs":{"tag":{"type":"string"}}}`)
	source := &dynamicTestSource{tool: dynamicTestTool{name: "plugin__demo__schema", schema: schema, risk: tools.RiskExec}}
	runner.SetDynamicToolSource(source)
	if err := runner.run(ctx, agent.ID, ""); err != nil {
		t.Fatal(err)
	}
	request := provider.request(0)
	var found *providers.ToolSpec
	for index := range request.Tools {
		if request.Tools[index].Name == "plugin__demo__schema" {
			found = &request.Tools[index]
			break
		}
	}
	if found == nil {
		t.Fatalf("dynamic tool missing from model snapshot: %+v", request.Tools)
	}
	encoded, _ := json.Marshal(found.Schema)
	var gotSchema, wantSchema any
	if err := json.Unmarshal(encoded, &gotSchema); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(schema, &wantSchema); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotSchema, wantSchema) {
		t.Fatalf("native MCP schema was reflected away:\n got %v\nwant %v", gotSchema, wantSchema)
	}
	source.mu.Lock()
	count := source.listCount
	source.mu.Unlock()
	if count != 1 {
		t.Fatalf("dynamic tools must be snapshotted once per run, listed %d times", count)
	}
}

func TestRunnerDynamicPluginToolUsesExecApprovalPolicy(t *testing.T) {
	ctx := context.Background()
	store, agent := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	runner := newAgentTestRunner(store, &scriptedProvider{}, config.AgentConfig{})
	source := &dynamicTestSource{tool: dynamicTestTool{name: "plugin__demo__exec", schema: json.RawMessage(`{"type":"object"}`), risk: tools.RiskExec}}
	runner.SetDynamicToolSource(source)
	result, err := runner.ExecuteTool(ctx, agent.ID, tools.Call{ID: "plugin-exec", Name: "plugin__demo__exec", Input: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || result.Output != "tool call requires approval in an agent loop" {
		t.Fatalf("plugin RiskExec bypassed approval policy: %+v", result)
	}
}

func dbMessage(agentID, text string) db.Message {
	return db.Message{AgentID: agentID, Role: "user", ContentText: text}
}
