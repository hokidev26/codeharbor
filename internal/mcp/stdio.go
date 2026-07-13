package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const DefaultProtocolVersion = "2024-11-05"

type StdioConfig struct {
	Command string
	Args    []string
	CWD     string
	Env     map[string]string
	Timeout time.Duration
}

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
}

type ToolCallResult struct {
	Content json.RawMessage `json:"content,omitempty"`
	IsError bool            `json:"isError,omitempty"`
	Raw     json.RawMessage `json:"raw,omitempty"`
}

type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	dec    *json.Decoder
	stderr *limitedBuffer
	cancel context.CancelFunc
	done   chan error
	mu     sync.Mutex
	nextID int64
}

func StartStdio(ctx context.Context, cfg StdioConfig) (*Client, error) {
	command := strings.TrimSpace(cfg.Command)
	if command == "" {
		return nil, errors.New("mcp command is required")
	}
	runCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(runCtx, command, cfg.Args...)
	if strings.TrimSpace(cfg.CWD) != "" {
		cmd.Dir = cfg.CWD
	}
	cmd.Env = os.Environ()
	for key, value := range cfg.Env {
		key = strings.TrimSpace(key)
		if key != "" {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stderr := &limitedBuffer{max: 64 << 10}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, err
	}
	client := &Client{cmd: cmd, stdin: stdin, dec: json.NewDecoder(stdout), stderr: stderr, cancel: cancel, done: make(chan error, 1), nextID: 1}
	go func() { client.done <- cmd.Wait() }()
	return client, nil
}

func (c *Client) Initialize(ctx context.Context) error {
	params := map[string]any{
		"protocolVersion": DefaultProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "Autoto", "version": "0.1"},
	}
	if _, err := c.Call(ctx, "initialize", params); err != nil {
		return err
	}
	return c.Notify(ctx, "notifications/initialized", map[string]any{})
}

func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	data, err := c.Call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var body struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	return body.Tools, nil
}

func (c *Client) CallTool(ctx context.Context, name string, arguments json.RawMessage) (ToolCallResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ToolCallResult{}, errors.New("mcp tool name is required")
	}
	args := json.RawMessage(`{}`)
	if len(arguments) > 0 && strings.TrimSpace(string(arguments)) != "" {
		args = arguments
	}
	params := map[string]any{"name": name, "arguments": args}
	data, err := c.Call(ctx, "tools/call", params)
	if err != nil {
		return ToolCallResult{}, err
	}
	var result ToolCallResult
	result.Raw = append(json.RawMessage(nil), data...)
	var body struct {
		Content json.RawMessage `json:"content"`
		IsError bool            `json:"isError"`
	}
	if err := json.Unmarshal(data, &body); err == nil {
		result.Content = body.Content
		result.IsError = body.IsError
	}
	return result, nil
}

func (c *Client) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		return nil, errors.New("mcp method is required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.nextID
	c.nextID++
	request := rpcRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params}
	if err := json.NewEncoder(c.stdin).Encode(request); err != nil {
		return nil, err
	}
	for {
		var response rpcResponse
		if err := decodeWithContext(ctx, c.dec, &response); err != nil {
			return nil, c.withProcessError(err)
		}
		if response.ID == nil || *response.ID != id {
			continue
		}
		if response.Error != nil {
			return nil, fmt.Errorf("mcp %s failed: %s", method, response.Error.Message)
		}
		return response.Result, nil
	}
}

func (c *Client) Notify(ctx context.Context, method string, params any) error {
	method = strings.TrimSpace(method)
	if method == "" {
		return errors.New("mcp method is required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	request := rpcNotification{JSONRPC: "2.0", Method: method, Params: params}
	if err := json.NewEncoder(c.stdin).Encode(request); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	_ = c.stdin.Close()
	c.cancel()
	select {
	case err := <-c.done:
		return err
	case <-time.After(2 * time.Second):
		if c.cmd != nil && c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
		}
		return context.DeadlineExceeded
	}
}

func (c *Client) withProcessError(err error) error {
	select {
	case procErr := <-c.done:
		stderr := strings.TrimSpace(c.stderr.String())
		if stderr != "" {
			return fmt.Errorf("%w; process exited: %v; stderr: %s", err, procErr, stderr)
		}
		return fmt.Errorf("%w; process exited: %v", err, procErr)
	default:
		return err
	}
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int64  `json:"code"`
	Message string `json:"message"`
}

func decodeWithContext(ctx context.Context, dec *json.Decoder, dst any) error {
	type result struct{ err error }
	ch := make(chan result, 1)
	go func() { ch <- result{err: dec.Decode(dst)} }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case result := <-ch:
		return result.err
	}
}

type limitedBuffer struct {
	buf bytes.Buffer
	max int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.max <= 0 || b.buf.Len() < b.max {
		remaining := b.max - b.buf.Len()
		if remaining <= 0 || remaining > len(p) {
			remaining = len(p)
		}
		_, _ = b.buf.Write(p[:remaining])
	}
	return len(p), nil
}

func (b *limitedBuffer) String() string { return b.buf.String() }
