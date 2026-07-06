package agent

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
	"codeharbor/internal/tools"
)

type Runner struct {
	store     *db.Store
	providers *providers.Registry
	tools     *tools.Registry
	hub       *Hub
	cfg       config.AgentConfig
}

func NewRunner(store *db.Store, providers *providers.Registry, toolRegistry *tools.Registry, hub *Hub, cfg config.AgentConfig) *Runner {
	return &Runner{store: store, providers: providers, tools: toolRegistry, hub: hub, cfg: cfg}
}

func (r *Runner) SubmitUserMessage(ctx context.Context, narratorID, text, createdBy string) (db.Message, error) {
	msg, err := r.store.AddMessage(ctx, db.Message{NarratorID: narratorID, Role: "user", ContentText: text, CreatedBy: createdBy})
	if err != nil {
		return db.Message{}, err
	}
	r.hub.Publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: msg.ID, Text: text})
	go r.Run(context.Background(), narratorID)
	return msg, nil
}

func (r *Runner) Run(ctx context.Context, narratorID string) {
	if err := r.run(ctx, narratorID); err != nil {
		slog.Error("agent loop failed", "narratorId", narratorID, "error", err)
		_ = r.store.SetNarratorStatus(context.Background(), narratorID, "error", err.Error())
		r.hub.Publish(Event{Type: "agent.error", NarratorID: narratorID, Text: err.Error()})
	}
}

func (r *Runner) run(ctx context.Context, narratorID string) error {
	if err := r.store.SetNarratorStatus(ctx, narratorID, "running", ""); err != nil {
		return err
	}
	r.hub.Publish(Event{Type: "agent.started", NarratorID: narratorID})

	narrator, err := r.store.GetNarrator(ctx, narratorID)
	if err != nil {
		return err
	}
	messages, err := r.store.ListMessages(ctx, narratorID)
	if err != nil {
		return err
	}
	provider, model, err := r.providers.Resolve(narrator.Model)
	if err != nil {
		return err
	}
	providerMessages := make([]providers.Message, 0, len(messages))
	for _, message := range messages {
		providerMessages = append(providerMessages, providers.Message{Role: message.Role, Content: message.ContentText})
	}
	events, err := provider.Generate(ctx, providers.GenerateRequest{Model: model, SystemPrompt: narrator.SystemPrompt, Messages: providerMessages})
	if err != nil {
		return err
	}
	var builder strings.Builder
	for event := range events {
		switch event.Type {
		case "text":
			builder.WriteString(event.Text)
			r.hub.Publish(Event{Type: "agent.text", NarratorID: narratorID, Text: event.Text})
		case "error":
			return &ProviderError{Message: event.Text}
		case "done":
			r.hub.Publish(Event{Type: "agent.done", NarratorID: narratorID})
		}
	}
	assistantText := builder.String()
	if assistantText == "" {
		assistantText = "Done."
	}
	assistantMsg, err := r.store.AddMessage(ctx, db.Message{NarratorID: narratorID, Role: "assistant", ContentText: assistantText})
	if err != nil {
		return err
	}
	r.hub.Publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: assistantMsg.ID, Text: assistantText})
	if err := r.store.SetNarratorStatus(ctx, narratorID, "idle", ""); err != nil {
		return err
	}
	return nil
}

type ToolInfo struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Risk        tools.Risk `json:"risk"`
}

func (r *Runner) ListTools() []ToolInfo {
	registered := r.tools.List()
	out := make([]ToolInfo, 0, len(registered))
	for _, tool := range registered {
		out = append(out, ToolInfo{Name: tool.Name(), Description: tool.Description(), Risk: tool.Risk(nil)})
	}
	return out
}

func (r *Runner) ExecuteTool(ctx context.Context, narratorID string, call tools.Call) (tools.Result, error) {
	narrator, err := r.store.GetNarrator(ctx, narratorID)
	if err != nil {
		return tools.Result{}, err
	}
	tool, err := r.tools.MustGet(call.Name)
	if err != nil {
		return tools.Result{}, err
	}
	risk := tool.Risk(call.Input)
	r.hub.Publish(Event{Type: "tool.started", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "risk": risk}})
	if !allowed(narrator.PermissionMode, call.Name, risk) {
		result := tools.Result{Output: "tool call denied by permission mode", IsError: true}
		output, _ := json.Marshal(result)
		_, _ = r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narratorID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: "denied", ErrorMessage: result.Output})
		r.hub.Publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": "denied", "risk": risk}})
		return result, nil
	}
	result, err := tool.Execute(ctx, call, tools.Env{NarratorID: narratorID, CWD: narrator.CWD})
	output, _ := json.Marshal(result)
	status := "completed"
	errMsg := ""
	if result.IsError {
		status = "error"
		errMsg = result.Output
	}
	if err != nil {
		status = "error"
		errMsg = err.Error()
	}
	_, _ = r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narratorID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: status, ErrorMessage: errMsg})
	r.hub.Publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": status, "risk": risk}})
	return result, err
}

func allowed(mode, toolName string, risk tools.Risk) bool {
	if risk == tools.RiskDanger {
		return false
	}
	switch mode {
	case "readOnly":
		return risk == tools.RiskRead
	case "bypassPermissions":
		return true
	case "acceptEdits", "default", "dontAsk":
		return risk == tools.RiskRead || risk == tools.RiskWrite
	default:
		return toolName == "Read" || toolName == "Glob" || toolName == "Grep"
	}
}

type ProviderError struct{ Message string }

func (e *ProviderError) Error() string { return e.Message }
