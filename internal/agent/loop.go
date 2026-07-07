package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

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

	runMu   sync.Mutex
	running map[string]*activeRun
}

type activeRun struct {
	cancel      context.CancelFunc
	pending     bool
	interrupted bool
}

type runCompletion struct {
	pending     bool
	interrupted bool
}

func NewRunner(store *db.Store, providers *providers.Registry, toolRegistry *tools.Registry, hub *Hub, cfg config.AgentConfig) *Runner {
	return &Runner{store: store, providers: providers, tools: toolRegistry, hub: hub, cfg: cfg, running: make(map[string]*activeRun)}
}

func (r *Runner) SubmitUserMessage(ctx context.Context, narratorID, text, createdBy string, attachments ...db.Attachment) (db.Message, error) {
	msg, err := r.store.AddMessageWithAttachments(ctx, db.Message{NarratorID: narratorID, Role: "user", ContentText: text, CreatedBy: createdBy}, attachments)
	if err != nil {
		return db.Message{}, err
	}
	r.publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: msg.ID, Text: text, Data: map[string]any{"attachments": len(msg.Attachments)}})
	go r.Run(context.Background(), narratorID)
	return msg, nil
}

func (r *Runner) Run(ctx context.Context, narratorID string) {
	runCtx, active, started := r.registerRun(ctx, narratorID)
	if !started {
		return
	}

	err := r.run(runCtx, narratorID)
	completion := r.unregisterRun(narratorID, active)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			if completion.interrupted || !completion.pending {
				slog.Info("agent loop interrupted", "narratorId", narratorID)
				_ = r.store.SetNarratorStatus(context.Background(), narratorID, "interrupted", "")
				r.publish(Event{Type: "agent.interrupted", NarratorID: narratorID})
				return
			}
			go r.Run(context.Background(), narratorID)
			return
		}
		slog.Error("agent loop failed", "narratorId", narratorID, "error", err)
		_ = r.store.SetNarratorStatus(context.Background(), narratorID, "error", err.Error())
		r.publish(Event{Type: "agent.error", NarratorID: narratorID, Text: err.Error()})
		if completion.pending {
			go r.Run(context.Background(), narratorID)
		}
		return
	}
	if completion.pending {
		go r.Run(context.Background(), narratorID)
	}
}

func (r *Runner) Interrupt(ctx context.Context, narratorID string) (bool, error) {
	if _, err := r.store.GetNarrator(ctx, narratorID); err != nil {
		return false, err
	}
	r.runMu.Lock()
	active := r.running[narratorID]
	var cancel context.CancelFunc
	if active != nil {
		active.pending = false
		active.interrupted = true
		cancel = active.cancel
	}
	r.runMu.Unlock()
	if cancel == nil {
		return false, nil
	}
	cancel()
	return true, nil
}

func (r *Runner) registerRun(ctx context.Context, narratorID string) (context.Context, *activeRun, bool) {
	r.runMu.Lock()
	if r.running == nil {
		r.running = make(map[string]*activeRun)
	}
	if active := r.running[narratorID]; active != nil {
		active.pending = true
		cancel := active.cancel
		r.runMu.Unlock()
		if cancel != nil {
			cancel()
		}
		return nil, nil, false
	}
	runCtx, cancel := context.WithCancel(ctx)
	active := &activeRun{cancel: cancel}
	r.running[narratorID] = active
	r.runMu.Unlock()
	return runCtx, active, true
}

func (r *Runner) unregisterRun(narratorID string, active *activeRun) runCompletion {
	completion := runCompletion{}
	r.runMu.Lock()
	if r.running[narratorID] == active {
		completion.pending = active.pending
		completion.interrupted = active.interrupted
		delete(r.running, narratorID)
	}
	r.runMu.Unlock()
	if active != nil && active.cancel != nil {
		active.cancel()
	}
	return completion
}

func (r *Runner) run(ctx context.Context, narratorID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.store.SetNarratorStatus(ctx, narratorID, "running", ""); err != nil {
		return err
	}
	r.publish(Event{Type: "agent.started", NarratorID: narratorID})

	narrator, err := r.store.GetNarrator(ctx, narratorID)
	if err != nil {
		return err
	}
	messages, err := r.store.ListMessagesWithAttachmentData(ctx, narratorID)
	if err != nil {
		return err
	}
	provider, model, err := r.providers.Resolve(narrator.Model)
	if err != nil {
		return err
	}
	providerMessages := make([]providers.Message, 0, len(messages))
	for _, message := range messages {
		providerMessages = append(providerMessages, providerMessageFromDB(message))
	}

	maxTurns := r.cfg.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 20
	}
	toolSpecs := r.toolSpecs()
	for turn := 0; turn < maxTurns; turn++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		result, err := r.runModelTurn(ctx, narratorID, provider, model, narrator.SystemPrompt, providerMessages, toolSpecs)
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(result.ToolCalls) == 0 {
			assistantText := result.Text
			if assistantText == "" {
				assistantText = "Done."
			}
			assistantMsg, err := r.store.AddMessage(ctx, db.Message{NarratorID: narratorID, Role: "assistant", ContentText: assistantText})
			if err != nil {
				return err
			}
			r.publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: assistantMsg.ID, Text: assistantText})
			r.publish(Event{Type: "agent.done", NarratorID: narratorID, Data: map[string]any{"stopReason": result.StopReason}})
			if err := r.store.SetNarratorStatus(ctx, narratorID, "idle", ""); err != nil {
				return err
			}
			return nil
		}

		assistantBlocks := assistantToolUseBlocks(result.Text, result.ToolCalls)
		assistantJSON, _ := json.Marshal(assistantBlocks)
		assistantText := assistantToolUseText(result.Text, result.ToolCalls)
		assistantMsg, err := r.store.AddMessage(ctx, db.Message{NarratorID: narratorID, Role: "assistant", ContentText: assistantText, ContentJSON: assistantJSON})
		if err != nil {
			return err
		}
		r.publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: assistantMsg.ID, Text: assistantText, Data: map[string]any{"toolCalls": len(result.ToolCalls)}})
		providerMessages = append(providerMessages, providerMessageFromDB(assistantMsg))

		for _, call := range result.ToolCalls {
			if err := ctx.Err(); err != nil {
				return err
			}
			toolCall := normalizeProviderToolCall(call)
			toolResult, err := r.executeTool(ctx, narratorID, tools.Call{ID: toolCall.ID, Name: toolCall.Name, Input: toolCall.Input}, assistantMsg.ID)
			if err != nil {
				toolResult = tools.Result{Output: err.Error(), IsError: true}
			}
			toolResultBlock := providers.ContentBlock{Type: "tool_result", ToolUseID: toolCall.ID, ToolName: toolCall.Name, Output: toolResult.Output, IsError: toolResult.IsError}
			toolResultJSON, _ := json.Marshal([]providers.ContentBlock{toolResultBlock})
			toolResultText := toolResultMessageText(toolCall, toolResult)
			toolMsg, err := r.store.AddMessage(ctx, db.Message{NarratorID: narratorID, Role: "user", ParentToolID: toolCall.ID, ContentText: toolResultText, ContentJSON: toolResultJSON})
			if err != nil {
				return err
			}
			r.publish(Event{Type: "message.created", NarratorID: narratorID, MessageID: toolMsg.ID, Text: toolResultText, Data: map[string]any{"parentToolUseId": toolCall.ID, "toolName": toolCall.Name, "isError": toolResult.IsError}})
			providerMessages = append(providerMessages, providerMessageFromDB(toolMsg))
		}
	}
	return fmt.Errorf("agent reached max turns (%d) while model kept requesting tools", maxTurns)
}

type modelTurnResult struct {
	Text       string
	ToolCalls  []providers.ToolCall
	Usage      providers.Usage
	StopReason string
}

func (r *Runner) runModelTurn(ctx context.Context, narratorID string, provider providers.Provider, model, systemPrompt string, messages []providers.Message, toolSpecs []providers.ToolSpec) (modelTurnResult, error) {
	started := time.Now()
	request := providers.GenerateRequest{Model: model, SystemPrompt: systemPrompt, Messages: messages, Tools: toolSpecs}
	events, err := provider.Generate(ctx, request)
	if err != nil {
		r.recordAPIRequest(narratorID, provider.Name(), model, time.Since(started), providers.Usage{}, err.Error())
		return modelTurnResult{}, err
	}

	var result modelTurnResult
	var builder strings.Builder
	for {
		select {
		case <-ctx.Done():
			err := ctx.Err()
			r.recordAPIRequest(narratorID, provider.Name(), model, time.Since(started), result.Usage, err.Error())
			return modelTurnResult{}, err
		case event, ok := <-events:
			if !ok {
				result.Text = builder.String()
				r.recordAPIRequest(narratorID, provider.Name(), model, time.Since(started), result.Usage, "")
				return result, nil
			}
			switch event.Type {
			case "text":
				builder.WriteString(event.Text)
				r.publish(Event{Type: "agent.text", NarratorID: narratorID, Text: event.Text})
			case "tool_call":
				if event.ToolCall != nil {
					result.ToolCalls = append(result.ToolCalls, normalizeProviderToolCall(*event.ToolCall))
				}
			case "usage":
				if event.Usage != nil {
					result.Usage = *event.Usage
				}
			case "error":
				err := &ProviderError{Message: event.Text}
				r.recordAPIRequest(narratorID, provider.Name(), model, time.Since(started), result.Usage, event.Text)
				return modelTurnResult{}, err
			case "done":
				result.Text = builder.String()
				result.StopReason = event.StopReason
				if shouldRecordAPIRequest(result.StopReason) {
					r.recordAPIRequest(narratorID, provider.Name(), model, time.Since(started), result.Usage, "")
				}
				return result, nil
			}
		}
	}
}

func shouldRecordAPIRequest(stopReason string) bool {
	return stopReason != "not_configured"
}

func (r *Runner) recordAPIRequest(narratorID, providerName, model string, duration time.Duration, usage providers.Usage, errorMessage string) {
	if r.store == nil {
		return
	}
	_, err := r.store.AddAPIRequest(context.Background(), db.APIRequest{
		NarratorID:        narratorID,
		Kind:              "model",
		Provider:          providerName,
		Model:             model,
		InputTokens:       usage.InputTokens,
		OutputTokens:      usage.OutputTokens,
		CachedInputTokens: usage.CachedInputTokens,
		ReasoningTokens:   usage.ReasoningTokens,
		DurationMS:        duration.Milliseconds(),
		CostUSD:           0,
		ErrorMessage:      errorMessage,
	})
	if err != nil {
		slog.Warn("record api request failed", "narratorId", narratorID, "error", err)
	}
}

func providerMessageFromDB(message db.Message) providers.Message {
	blocks := contentBlocksFromMessage(message)
	return providers.Message{Role: message.Role, Content: message.ContentText, Blocks: blocks}
}

func contentBlocksFromMessage(message db.Message) []providers.ContentBlock {
	blocks := contentBlocksFromJSON(message.ContentJSON)
	if len(blocks) == 0 {
		content := strings.TrimSpace(message.ContentText)
		if content != "" {
			blocks = append(blocks, providers.ContentBlock{Type: "text", Text: content})
		}
	}
	blocks = append(blocks, attachmentBlocks(message)...)
	return blocks
}

func contentBlocksFromJSON(raw json.RawMessage) []providers.ContentBlock {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	var blocks []providers.ContentBlock
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return nil
	}
	return blocks
}

func attachmentBlocks(message db.Message) []providers.ContentBlock {
	blocks := make([]providers.ContentBlock, 0, len(message.Attachments))
	for _, attachment := range message.Attachments {
		name := attachment.Filename
		if name == "" {
			name = "attachment"
		}
		switch attachment.Kind {
		case "image":
			if len(attachment.Data) > 0 {
				blocks = append(blocks, providers.ContentBlock{Type: "image", MIMEType: attachment.MIMEType, Data: attachment.Data, Filename: name, Kind: attachment.Kind})
			}
		case "text", "docx":
			if strings.TrimSpace(attachment.ExtractedText) != "" {
				blocks = append(blocks, providers.ContentBlock{Type: "text", Text: fmt.Sprintf("附件 %s 的内容：\n%s", name, attachment.ExtractedText), Filename: name, MIMEType: attachment.MIMEType, Kind: attachment.Kind})
			} else {
				blocks = append(blocks, providers.ContentBlock{Type: "text", Text: fmt.Sprintf("附件 %s 已上传，但没有可抽取文本。", name), Filename: name, MIMEType: attachment.MIMEType, Kind: attachment.Kind})
			}
		case "pdf":
			if strings.TrimSpace(attachment.ExtractedText) != "" {
				blocks = append(blocks, providers.ContentBlock{Type: "text", Text: fmt.Sprintf("PDF 附件 %s 的可抽取文字：\n%s", name, attachment.ExtractedText), Filename: name, MIMEType: attachment.MIMEType, Kind: attachment.Kind})
			} else {
				blocks = append(blocks, providers.ContentBlock{Type: "text", Text: fmt.Sprintf("PDF 附件 %s 已上传，但当前无法抽取可读文字；它可能是扫描件，或需要支持原生 PDF/视觉/OCR 的模型。", name), Filename: name, MIMEType: attachment.MIMEType, Kind: attachment.Kind})
			}
		default:
			blocks = append(blocks, providers.ContentBlock{Type: "text", Text: fmt.Sprintf("附件 %s 已上传，类型 %s；当前模型链路没有可读文本可传递。", name, attachment.MIMEType), Filename: name, MIMEType: attachment.MIMEType, Kind: attachment.Kind})
		}
	}
	return blocks
}

type ToolInfo struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Risk        tools.Risk `json:"risk"`
}

func (r *Runner) ListTools() []ToolInfo {
	if r.tools == nil {
		return []ToolInfo{}
	}
	registered := r.tools.List()
	out := make([]ToolInfo, 0, len(registered))
	for _, tool := range registered {
		out = append(out, ToolInfo{Name: tool.Name(), Description: tool.Description(), Risk: tool.Risk(nil)})
	}
	return out
}

func (r *Runner) ExecuteTool(ctx context.Context, narratorID string, call tools.Call) (tools.Result, error) {
	return r.executeTool(ctx, narratorID, call, "")
}

func (r *Runner) executeTool(ctx context.Context, narratorID string, call tools.Call, messageID string) (tools.Result, error) {
	if call.ID == "" {
		call.ID = db.NewID()
	}
	if len(call.Input) == 0 {
		call.Input = json.RawMessage(`{}`)
	}
	narrator, err := r.store.GetNarrator(ctx, narratorID)
	if err != nil {
		return tools.Result{}, err
	}
	if r.tools == nil {
		return tools.Result{}, errors.New("tool registry is not initialized")
	}
	tool, err := r.tools.MustGet(call.Name)
	if err != nil {
		return tools.Result{}, err
	}
	risk := tool.Risk(call.Input)
	r.publish(Event{Type: "tool.started", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "risk": risk}})
	if !allowed(narrator.PermissionMode, call.Name, risk) {
		result := tools.Result{Output: "tool call denied by permission mode", IsError: true}
		output, _ := json.Marshal(result)
		if _, err := r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narratorID, MessageID: messageID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: "denied", ErrorMessage: result.Output}); err != nil {
			slog.Warn("record denied tool call failed", "narratorId", narratorID, "toolUseId", call.ID, "error", err)
		}
		r.publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": "denied", "risk": risk}})
		return result, nil
	}
	started := time.Now()
	result, err := tool.Execute(ctx, call, tools.Env{NarratorID: narratorID, CWD: narrator.CWD})
	duration := time.Since(started).Milliseconds()
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
	if _, recordErr := r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narratorID, MessageID: messageID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: status, DurationMS: duration, ErrorMessage: errMsg}); recordErr != nil {
		slog.Warn("record tool call failed", "narratorId", narratorID, "toolUseId", call.ID, "error", recordErr)
	}
	r.publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": status, "risk": risk, "durationMs": duration}})
	return result, err
}

func (r *Runner) toolSpecs() []providers.ToolSpec {
	if r.tools == nil {
		return nil
	}
	registered := r.tools.List()
	sort.Slice(registered, func(i, j int) bool { return registered[i].Name() < registered[j].Name() })
	out := make([]providers.ToolSpec, 0, len(registered))
	for _, tool := range registered {
		out = append(out, providers.ToolSpec{Name: tool.Name(), Description: tool.Description(), Schema: toolInputSchema(tool.Schema())})
	}
	return out
}

func toolInputSchema(input any) map[string]any {
	schema := map[string]any{"type": "object", "properties": map[string]any{}}
	t := reflect.TypeOf(input)
	if t == nil {
		return schema
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return schema
	}
	properties := map[string]any{}
	required := make([]string, 0)
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.PkgPath != "" {
			continue
		}
		name, omitEmpty := jsonFieldName(field)
		if name == "" {
			continue
		}
		properties[name] = map[string]any{"type": jsonSchemaType(field.Type)}
		if !omitEmpty {
			required = append(required, name)
		}
	}
	schema["properties"] = properties
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func jsonFieldName(field reflect.StructField) (string, bool) {
	name := field.Name
	omitEmpty := false
	if tag := field.Tag.Get("json"); tag != "" {
		parts := strings.Split(tag, ",")
		if parts[0] == "-" {
			return "", false
		}
		if parts[0] != "" {
			name = parts[0]
		}
		for _, part := range parts[1:] {
			if part == "omitempty" {
				omitEmpty = true
			}
		}
	}
	return name, omitEmpty
}

func jsonSchemaType(t reflect.Type) string {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Bool:
		return "boolean"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "integer"
	case reflect.Float32, reflect.Float64:
		return "number"
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 {
			return "string"
		}
		return "array"
	case reflect.Map, reflect.Struct:
		return "object"
	default:
		return "string"
	}
}

func assistantToolUseBlocks(text string, calls []providers.ToolCall) []providers.ContentBlock {
	blocks := make([]providers.ContentBlock, 0, 1+len(calls))
	if strings.TrimSpace(text) != "" {
		blocks = append(blocks, providers.ContentBlock{Type: "text", Text: text})
	}
	for _, call := range calls {
		call = normalizeProviderToolCall(call)
		blocks = append(blocks, providers.ContentBlock{Type: "tool_use", ToolUseID: call.ID, ToolName: call.Name, Input: call.Input})
	}
	return blocks
}

func assistantToolUseText(text string, calls []providers.ToolCall) string {
	parts := make([]string, 0, 1+len(calls))
	if strings.TrimSpace(text) != "" {
		parts = append(parts, strings.TrimSpace(text))
	}
	for _, call := range calls {
		call = normalizeProviderToolCall(call)
		parts = append(parts, fmt.Sprintf("Tool requested: %s (%s)", call.Name, call.ID))
	}
	return strings.Join(parts, "\n")
}

func toolResultMessageText(call providers.ToolCall, result tools.Result) string {
	status := "completed"
	if result.IsError {
		status = "error"
	}
	output := strings.TrimSpace(result.Output)
	if output == "" {
		output = "(empty output)"
	}
	return fmt.Sprintf("Tool %s (%s) %s:\n%s", call.Name, call.ID, status, output)
}

func normalizeProviderToolCall(call providers.ToolCall) providers.ToolCall {
	call.ID = strings.TrimSpace(call.ID)
	if call.ID == "" {
		call.ID = db.NewID()
	}
	call.Name = strings.TrimSpace(call.Name)
	if len(call.Input) == 0 || strings.TrimSpace(string(call.Input)) == "" {
		call.Input = json.RawMessage(`{}`)
	}
	return call
}

func (r *Runner) publish(event Event) {
	if r.hub != nil {
		r.hub.Publish(event)
	}
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
