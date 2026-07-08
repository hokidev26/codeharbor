package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"codeharbor/internal/mcp"
)

type MCPListToolsTool struct{}
type MCPCallToolTool struct{}

type mcpServerInput struct {
	ServerID string            `json:"serverId,omitempty"`
	Command  string            `json:"command,omitempty"`
	Args     []string          `json:"args,omitempty"`
	CWD      string            `json:"cwd,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Timeout  int               `json:"timeout,omitempty"`
}

type mcpListToolsInput struct {
	ServerID string            `json:"serverId,omitempty"`
	Command  string            `json:"command,omitempty"`
	Args     []string          `json:"args,omitempty"`
	CWD      string            `json:"cwd,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Timeout  int               `json:"timeout,omitempty"`
}

type mcpCallToolInput struct {
	ServerID  string            `json:"serverId,omitempty"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	CWD       string            `json:"cwd,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Timeout   int               `json:"timeout,omitempty"`
	ToolName  string            `json:"toolName"`
	Arguments json.RawMessage   `json:"arguments,omitempty"`
}

func (MCPListToolsTool) Name() string { return "MCPListTools" }
func (MCPListToolsTool) Description() string {
	return "Start a stdio MCP server process and list the tools it exposes. Requires approval because it runs a local process."
}
func (MCPListToolsTool) Schema() any               { return mcpListToolsInput{} }
func (MCPListToolsTool) Risk(json.RawMessage) Risk { return RiskExec }

func (MCPListToolsTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input mcpListToolsInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	cfg, err := mcpConfigFromInput(ctx, mcpServerInput{ServerID: input.ServerID, Command: input.Command, Args: input.Args, CWD: input.CWD, Env: input.Env, Timeout: input.Timeout}, env)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	client, cancel, err := startMCPClient(ctx, cfg)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	defer cancel()
	tools, err := client.ListTools(ctx)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	data, _ := json.MarshalIndent(tools, "", "  ")
	return Result{Output: formatMCPTools(tools), Meta: map[string]any{"tools": len(tools), "raw": string(data)}}, nil
}

func (MCPCallToolTool) Name() string { return "MCPCallTool" }
func (MCPCallToolTool) Description() string {
	return "Start a stdio MCP server process and call one of its tools. Requires approval because it runs a local process and delegated tool."
}
func (MCPCallToolTool) Schema() any               { return mcpCallToolInput{} }
func (MCPCallToolTool) Risk(json.RawMessage) Risk { return RiskExec }

func (MCPCallToolTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input mcpCallToolInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	cfg, err := mcpConfigFromInput(ctx, mcpServerInput{ServerID: input.ServerID, Command: input.Command, Args: input.Args, CWD: input.CWD, Env: input.Env, Timeout: input.Timeout}, env)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	toolName := strings.TrimSpace(input.ToolName)
	if toolName == "" {
		return Result{Output: "toolName is required", IsError: true}, nil
	}
	client, cancel, err := startMCPClient(ctx, cfg)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	defer cancel()
	result, err := client.CallTool(ctx, toolName, input.Arguments)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	out := formatMCPToolResult(result)
	return Result{Output: out, IsError: result.IsError, Meta: map[string]any{"toolName": toolName, "raw": string(result.Raw)}}, nil
}

func MCPCommand(input json.RawMessage) string {
	var parsed mcpServerInput
	_ = json.Unmarshal(input, &parsed)
	if serverID := strings.TrimSpace(parsed.ServerID); serverID != "" {
		return "mcp server " + serverID
	}
	parts := append([]string{strings.TrimSpace(parsed.Command)}, parsed.Args...)
	return strings.TrimSpace(strings.Join(parts, " "))
}

func mcpConfigFromInput(ctx context.Context, input mcpServerInput, env Env) (mcp.StdioConfig, error) {
	if serverID := strings.TrimSpace(input.ServerID); serverID != "" {
		if env.Store == nil {
			return mcp.StdioConfig{}, fmt.Errorf("store is required for registered MCP server %q", serverID)
		}
		server, err := env.Store.GetMCPServer(ctx, serverID)
		if err != nil {
			return mcp.StdioConfig{}, err
		}
		if !server.Enabled {
			return mcp.StdioConfig{}, fmt.Errorf("mcp server %q is disabled", serverID)
		}
		input.Command = server.Command
		input.Args = append([]string(nil), server.Args...)
		input.CWD = server.CWD
		input.Env = server.Env
	}
	command := strings.TrimSpace(input.Command)
	args := append([]string(nil), input.Args...)
	if command == "" {
		return mcp.StdioConfig{}, fmt.Errorf("command is required")
	}
	if len(args) == 0 {
		parts := strings.Fields(command)
		if len(parts) > 1 {
			command = parts[0]
			args = parts[1:]
		}
	}
	cwd := strings.TrimSpace(input.CWD)
	if cwd == "" {
		cwd = env.CWD
	}
	timeout := time.Duration(input.Timeout) * time.Millisecond
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return mcp.StdioConfig{Command: command, Args: args, CWD: cwd, Env: input.Env, Timeout: timeout}, nil
}

func startMCPClient(ctx context.Context, cfg mcp.StdioConfig) (*mcp.Client, func(), error) {
	clientCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	client, err := mcp.StartStdio(clientCtx, cfg)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	cleanup := func() {
		_ = client.Close()
		cancel()
	}
	if err := client.Initialize(clientCtx); err != nil {
		cleanup()
		return nil, nil, err
	}
	return client, cleanup, nil
}

func formatMCPTools(tools []mcp.Tool) string {
	if len(tools) == 0 {
		return "No MCP tools returned."
	}
	var builder strings.Builder
	builder.WriteString("MCP tools:\n")
	for i, tool := range tools {
		builder.WriteString(fmt.Sprintf("\n%d. %s", i+1, tool.Name))
		if strings.TrimSpace(tool.Description) != "" {
			builder.WriteString(" — ")
			builder.WriteString(strings.TrimSpace(tool.Description))
		}
		if len(tool.InputSchema) > 0 {
			builder.WriteString("\n   inputSchema: ")
			builder.WriteString(string(tool.InputSchema))
		}
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String())
}

func formatMCPToolResult(result mcp.ToolCallResult) string {
	if len(result.Content) == 0 || strings.TrimSpace(string(result.Content)) == "null" {
		if len(result.Raw) > 0 {
			return string(result.Raw)
		}
		return ""
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(result.Content, &blocks); err == nil {
		texts := make([]string, 0, len(blocks))
		for _, block := range blocks {
			if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
				texts = append(texts, strings.TrimSpace(block.Text))
			}
		}
		if len(texts) > 0 {
			return strings.Join(texts, "\n")
		}
	}
	return string(result.Content)
}
