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

	approvalMu    sync.Mutex
	approvals     map[string]*pendingApproval
	sessionGrants map[string]map[string]struct{}
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

type pendingApproval struct {
	NarratorID string
	ToolUseID  string
	ToolName   string
	Input      json.RawMessage
	Risk       tools.Risk
	CWD        string
	Command    string
	Reason     string
	Warning    string
	GrantKey   string
	ExpiresAt  time.Time
	Decision   chan ToolApprovalDecision
}

type ToolApprovalDecision struct {
	Decision  string
	Reason    string
	DecidedBy string
}

const (
	toolApprovalTimeout       = 10 * time.Minute
	defaultContextTokenLimit  = 120000
	contextKeepRecentMessages = 8
	maxDeterministicSummary   = 8000
	maxSummaryLineRunes       = 240
)

func NewRunner(store *db.Store, providers *providers.Registry, toolRegistry *tools.Registry, hub *Hub, cfg config.AgentConfig) *Runner {
	return &Runner{store: store, providers: providers, tools: toolRegistry, hub: hub, cfg: cfg, running: make(map[string]*activeRun), approvals: make(map[string]*pendingApproval), sessionGrants: make(map[string]map[string]struct{})}
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

func (r *Runner) ApproveToolCall(ctx context.Context, narratorID, toolUseID string, decision ToolApprovalDecision) (bool, error) {
	if _, err := r.store.GetNarrator(ctx, narratorID); err != nil {
		return false, err
	}
	decision.Decision = strings.TrimSpace(decision.Decision)
	if decision.Decision != "allow_once" && decision.Decision != "allow_session" && decision.Decision != "deny" {
		return false, fmt.Errorf("invalid approval decision: %s", decision.Decision)
	}
	key := approvalKey(narratorID, toolUseID)
	r.approvalMu.Lock()
	approval := r.approvals[key]
	if approval == nil {
		r.approvalMu.Unlock()
		return false, nil
	}
	if decision.Decision == "allow_session" {
		r.addSessionGrantLocked(narratorID, approval.GrantKey)
	}
	r.approvalMu.Unlock()
	select {
	case approval.Decision <- decision:
		return true, nil
	case <-ctx.Done():
		return false, ctx.Err()
	default:
		return false, nil
	}
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

	maxTurns := r.cfg.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 20
	}
	toolSpecs := r.toolSpecs()
	for turn := 0; turn < maxTurns; turn++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		providerMessages, updatedNarrator, err := r.managedContextForTurn(ctx, narrator, messages, toolSpecs)
		if err != nil {
			return err
		}
		narrator = updatedNarrator
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
		messages = append(messages, assistantMsg)

		for _, call := range result.ToolCalls {
			if err := ctx.Err(); err != nil {
				return err
			}
			toolCall := normalizeProviderToolCall(call)
			toolResult, err := r.executeToolForLoop(ctx, narratorID, tools.Call{ID: toolCall.ID, Name: toolCall.Name, Input: toolCall.Input}, assistantMsg.ID)
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
			messages = append(messages, toolMsg)
		}
	}
	return fmt.Errorf("agent reached max turns (%d) while model kept requesting tools", maxTurns)
}

func (r *Runner) managedContextForTurn(ctx context.Context, narrator db.Narrator, messages []db.Message, toolSpecs []providers.ToolSpec) ([]providers.Message, db.Narrator, error) {
	providerMessages := providerMessagesForContext(narrator, messages)
	limit := r.contextTokenLimit()
	if estimateRequestTokens(narrator.SystemPrompt, providerMessages, toolSpecs) <= limit {
		return providerMessages, narrator, nil
	}

	candidates := selectSummaryCandidates(messages, narrator.PruneBoundaryMessageID, contextKeepRecentMessages)
	if len(candidates) == 0 {
		return providerMessages, narrator, nil
	}
	summary := strings.TrimSpace(r.summarizeOldestMessages(ctx, narrator, candidates))
	if summary == "" {
		return providerMessages, narrator, nil
	}
	boundaryID := candidates[len(candidates)-1].ID
	prunedPercent := 0
	if len(messages) > 0 {
		prunedPercent = int(float64(len(candidates)) / float64(len(messages)) * 100)
	}
	if err := r.store.UpdateNarratorContextSummary(ctx, narrator.ID, summary, boundaryID, prunedPercent); err != nil {
		return nil, narrator, err
	}
	narrator.ContextSummary = summary
	narrator.PruneBoundaryMessageID = boundaryID
	narrator.PrunedPercent = prunedPercent
	return providerMessagesForContext(narrator, messages), narrator, nil
}

func (r *Runner) contextTokenLimit() int {
	if r.cfg.ContextTokenLimit > 0 {
		return r.cfg.ContextTokenLimit
	}
	return defaultContextTokenLimit
}

func providerMessagesForContext(narrator db.Narrator, messages []db.Message) []providers.Message {
	start := messagesStartAfterBoundary(messages, narrator.PruneBoundaryMessageID)
	out := make([]providers.Message, 0, len(messages)-start+1)
	if summary := strings.TrimSpace(narrator.ContextSummary); summary != "" {
		out = append(out, summaryProviderMessage(summary))
	}
	compactBefore := len(messages) - contextKeepRecentMessages
	for i := start; i < len(messages); i++ {
		message := providerMessageFromDBForContext(messages[i], i < compactBefore)
		if strings.TrimSpace(message.Content) == "" && len(message.Blocks) == 0 {
			continue
		}
		out = append(out, message)
	}
	return out
}

func messagesStartAfterBoundary(messages []db.Message, boundaryID string) int {
	if strings.TrimSpace(boundaryID) == "" {
		return 0
	}
	for i, message := range messages {
		if message.ID == boundaryID {
			return i + 1
		}
	}
	return 0
}

func summaryProviderMessage(summary string) providers.Message {
	text := "以下是较早对话的压缩摘要，后续消息仍按时间顺序完整提供：\n" + strings.TrimSpace(summary)
	return providers.Message{Role: "system", Content: text, Blocks: []providers.ContentBlock{{Type: "text", Text: text}}}
}

func providerMessageFromDBForContext(message db.Message, compactToolResult bool) providers.Message {
	blocks := contentBlocksFromMessage(message)
	content := message.ContentText
	if compactToolResult {
		blocks = compactToolResultBlocks(blocks)
		if contentFromBlocks := contextMessageContent(blocks); strings.TrimSpace(contentFromBlocks) != "" {
			content = contentFromBlocks
		}
	}
	return providers.Message{Role: message.Role, Content: content, Blocks: blocks}
}

func compactToolResultBlocks(blocks []providers.ContentBlock) []providers.ContentBlock {
	if len(blocks) == 0 {
		return blocks
	}
	out := make([]providers.ContentBlock, len(blocks))
	copy(out, blocks)
	for i := range out {
		if out[i].Type != "tool_result" {
			continue
		}
		out[i].Output = compactToolResultOutput(out[i].ToolName)
	}
	return out
}

func compactToolResultOutput(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		toolName = "工具"
	}
	return fmt.Sprintf("[工具 %s 已执行，输出已省略]", toolName)
}

func contextMessageContent(blocks []providers.ContentBlock) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		switch block.Type {
		case "tool_result":
			if text := strings.TrimSpace(block.Output); text != "" {
				parts = append(parts, text)
			}
		case "tool_use":
			parts = append(parts, fmt.Sprintf("[请求工具 %s %s]", strings.TrimSpace(block.ToolName), strings.TrimSpace(block.ToolUseID)))
		case "image":
			name := strings.TrimSpace(block.Filename)
			if name == "" {
				name = "image"
			}
			parts = append(parts, fmt.Sprintf("[图片附件 %s]", name))
		default:
			if text := strings.TrimSpace(block.Text); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n\n")
}

func selectSummaryCandidates(messages []db.Message, boundaryID string, keepRecent int) []db.Message {
	if keepRecent <= 0 {
		keepRecent = contextKeepRecentMessages
	}
	start := messagesStartAfterBoundary(messages, boundaryID)
	if len(messages)-start <= keepRecent {
		return nil
	}
	end := len(messages) - keepRecent
	for end < len(messages) && strings.TrimSpace(messages[end].ParentToolID) != "" {
		end++
	}
	if end <= start {
		return nil
	}
	return messages[start:end]
}

func estimateRequestTokens(systemPrompt string, messages []providers.Message, toolSpecs []providers.ToolSpec) int {
	total := estimateTextTokens(systemPrompt)
	if len(toolSpecs) > 0 {
		data, _ := json.Marshal(toolSpecs)
		total += estimateTextTokens(string(data))
	}
	for _, message := range messages {
		total += estimateMessageTokens(message)
	}
	return total
}

func estimateMessageTokens(message providers.Message) int {
	total := estimateTextTokens(message.Role)
	if len(message.Blocks) == 0 {
		total += estimateTextTokens(message.Content)
	}
	for _, block := range message.Blocks {
		total += estimateBlockTokens(block)
	}
	return total
}

func estimateBlockTokens(block providers.ContentBlock) int {
	total := estimateTextTokens(block.Type) + estimateTextTokens(block.Text) + estimateTextTokens(block.Output) + estimateTextTokens(block.ToolName) + estimateTextTokens(block.ToolUseID) + estimateTextTokens(block.Filename) + estimateTextTokens(block.MIMEType)
	if len(block.Input) > 0 {
		total += estimateTextTokens(string(block.Input))
	}
	return total
}

func estimateTextTokens(text string) int {
	count := len([]rune(text))
	if count == 0 {
		return 0
	}
	return (count + 3) / 4
}

func (r *Runner) summarizeOldestMessages(ctx context.Context, narrator db.Narrator, candidates []db.Message) string {
	if summary, err := r.summarizeWithModel(ctx, narrator.ContextSummary, candidates); err == nil && strings.TrimSpace(summary) != "" {
		return strings.TrimSpace(summary)
	} else if err != nil {
		slog.Warn("summary model unavailable, using local context summary", "narratorId", narrator.ID, "error", err)
	}
	return deterministicSummary(narrator.ContextSummary, candidates)
}

func (r *Runner) summarizeWithModel(ctx context.Context, existingSummary string, candidates []db.Message) (string, error) {
	if r.providers == nil || strings.TrimSpace(r.cfg.SummaryModel) == "" {
		return "", errors.New("summary model is not configured")
	}
	provider, model, err := r.providers.Resolve(r.cfg.SummaryModel)
	if err != nil {
		return "", err
	}
	prompt := "请把下面较早的对话历史压缩成一段供后续 Agent 继续工作的中文摘要。保留用户目标、关键决策、文件路径、工具执行结果状态和未完成事项；省略大段工具输出。不要编造。\n\n" + renderMessagesForSummary(existingSummary, candidates)
	request := providers.GenerateRequest{Model: model, SystemPrompt: "你是 CodeHarbor 的长期上下文摘要器，只输出摘要正文。", Messages: []providers.Message{{Role: "user", Content: prompt, Blocks: []providers.ContentBlock{{Type: "text", Text: prompt}}}}}
	summaryCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	events, err := provider.Generate(summaryCtx, request)
	if err != nil {
		return "", err
	}
	var builder strings.Builder
	for {
		select {
		case <-summaryCtx.Done():
			return "", summaryCtx.Err()
		case event, ok := <-events:
			if !ok {
				text := strings.TrimSpace(builder.String())
				if text == "" {
					return "", errors.New("summary model returned empty response")
				}
				return text, nil
			}
			switch event.Type {
			case "text":
				builder.WriteString(event.Text)
			case "error":
				return "", errors.New(event.Text)
			case "done":
				if event.StopReason == "not_configured" {
					return "", errors.New("summary model provider is not configured")
				}
				text := strings.TrimSpace(builder.String())
				if text == "" {
					return "", errors.New("summary model returned empty response")
				}
				return text, nil
			}
		}
	}
}

func renderMessagesForSummary(existingSummary string, messages []db.Message) string {
	var builder strings.Builder
	if summary := strings.TrimSpace(existingSummary); summary != "" {
		builder.WriteString("已有摘要：\n")
		builder.WriteString(truncateRunes(summary, maxDeterministicSummary/2))
		builder.WriteString("\n\n新增压缩内容：\n")
	}
	for _, message := range messages {
		builder.WriteString(messageSummaryLine(message, maxSummaryLineRunes*2))
		builder.WriteByte('\n')
	}
	return truncateRunes(builder.String(), maxDeterministicSummary*2)
}

func deterministicSummary(existingSummary string, messages []db.Message) string {
	var builder strings.Builder
	builder.WriteString("较早对话摘要（本地降级生成）：\n")
	if summary := strings.TrimSpace(existingSummary); summary != "" {
		builder.WriteString("已有摘要：\n")
		builder.WriteString(truncateRunes(summary, maxDeterministicSummary/2))
		builder.WriteString("\n")
	}
	builder.WriteString("新增压缩内容：\n")
	for _, message := range messages {
		builder.WriteString(messageSummaryLine(message, maxSummaryLineRunes))
		builder.WriteByte('\n')
		if len([]rune(builder.String())) >= maxDeterministicSummary {
			break
		}
	}
	return truncateRunes(builder.String(), maxDeterministicSummary)
}

func messageSummaryLine(message db.Message, maxRunes int) string {
	role := strings.TrimSpace(message.Role)
	if role == "" {
		role = "message"
	}
	parts := make([]string, 0)
	blocks := contentBlocksFromMessage(message)
	for _, block := range blocks {
		switch block.Type {
		case "tool_result":
			status := "已执行"
			if block.IsError {
				status = "执行出错"
			}
			name := strings.TrimSpace(block.ToolName)
			if name == "" {
				name = "工具"
			}
			parts = append(parts, fmt.Sprintf("[工具 %s %s，输出已省略]", name, status))
		case "tool_use":
			name := strings.TrimSpace(block.ToolName)
			if name == "" {
				name = "工具"
			}
			parts = append(parts, fmt.Sprintf("[请求工具 %s %s]", name, strings.TrimSpace(block.ToolUseID)))
		case "image":
			name := strings.TrimSpace(block.Filename)
			if name == "" {
				name = "image"
			}
			parts = append(parts, fmt.Sprintf("[图片附件 %s 已省略]", name))
		default:
			if text := strings.TrimSpace(block.Text); text != "" {
				parts = append(parts, text)
			}
		}
	}
	if len(parts) == 0 && strings.TrimSpace(message.ContentText) != "" {
		parts = append(parts, strings.TrimSpace(message.ContentText))
	}
	text := strings.Join(parts, " ")
	if text == "" {
		text = "[空消息]"
	}
	return fmt.Sprintf("- %s: %s", role, truncateRunes(text, maxRunes))
}

func truncateRunes(text string, maxRunes int) string {
	text = strings.TrimSpace(text)
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	if maxRunes <= 1 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-1]) + "…"
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
		CostUSD:           estimateUsageCostUSD(providerName, model, usage),
		ErrorMessage:      errorMessage,
	})
	if err != nil {
		slog.Warn("record api request failed", "narratorId", narratorID, "error", err)
	}
}

type tokenPrice struct {
	InputPerMTok       float64
	CachedInputPerMTok float64
	OutputPerMTok      float64
}

func estimateUsageCostUSD(providerName, model string, usage providers.Usage) float64 {
	price, ok := modelTokenPrice(providerName, model)
	if !ok {
		return 0
	}
	cachedInput := usage.CachedInputTokens
	if cachedInput < 0 {
		cachedInput = 0
	}
	if cachedInput > usage.InputTokens {
		cachedInput = usage.InputTokens
	}
	uncachedInput := usage.InputTokens - cachedInput
	if uncachedInput < 0 {
		uncachedInput = 0
	}
	return (float64(uncachedInput)*price.InputPerMTok + float64(cachedInput)*price.CachedInputPerMTok + float64(usage.OutputTokens)*price.OutputPerMTok) / 1_000_000
}

func modelTokenPrice(providerName, model string) (tokenPrice, bool) {
	provider := strings.ToLower(strings.TrimSpace(providerName))
	name := strings.ToLower(strings.TrimSpace(model))
	if _, stripped := providers.SplitModel(name); stripped != name && stripped != "" {
		name = stripped
	}
	openAIPrices := []struct {
		match string
		price tokenPrice
	}{
		{match: "gpt-5.5", price: tokenPrice{InputPerMTok: 5.00, CachedInputPerMTok: 0.50, OutputPerMTok: 30.00}},
		{match: "gpt-5.4-mini", price: tokenPrice{InputPerMTok: 0.75, CachedInputPerMTok: 0.075, OutputPerMTok: 4.50}},
		{match: "gpt-5.4", price: tokenPrice{InputPerMTok: 2.50, CachedInputPerMTok: 0.25, OutputPerMTok: 15.00}},
		{match: "gpt-4.1-mini", price: tokenPrice{InputPerMTok: 0.40, CachedInputPerMTok: 0.10, OutputPerMTok: 1.60}},
		{match: "gpt-4.1-nano", price: tokenPrice{InputPerMTok: 0.10, CachedInputPerMTok: 0.025, OutputPerMTok: 0.40}},
		{match: "gpt-4.1", price: tokenPrice{InputPerMTok: 2.00, CachedInputPerMTok: 0.50, OutputPerMTok: 8.00}},
		{match: "gpt-4o-mini", price: tokenPrice{InputPerMTok: 0.15, CachedInputPerMTok: 0.075, OutputPerMTok: 0.60}},
		{match: "gpt-4o", price: tokenPrice{InputPerMTok: 2.50, CachedInputPerMTok: 1.25, OutputPerMTok: 10.00}},
	}
	if strings.Contains(provider, "openai") || strings.Contains(provider, "cliproxy") || strings.HasPrefix(name, "gpt-") {
		for _, candidate := range openAIPrices {
			if strings.HasPrefix(name, candidate.match) {
				return candidate.price, true
			}
		}
	}

	anthropicPrice := tokenPrice{}
	switch {
	case strings.HasPrefix(name, "claude-sonnet-5"):
		anthropicPrice = tokenPrice{InputPerMTok: 2.00, CachedInputPerMTok: 0.20, OutputPerMTok: 10.00}
	case strings.HasPrefix(name, "claude-opus-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 5.00, CachedInputPerMTok: 0.50, OutputPerMTok: 25.00}
	case strings.HasPrefix(name, "claude-sonnet-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 3.00, CachedInputPerMTok: 0.30, OutputPerMTok: 15.00}
	case strings.HasPrefix(name, "claude-haiku-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 1.00, CachedInputPerMTok: 0.10, OutputPerMTok: 5.00}
	case strings.HasPrefix(name, "claude-3-5-haiku"):
		anthropicPrice = tokenPrice{InputPerMTok: 0.80, CachedInputPerMTok: 0.08, OutputPerMTok: 4.00}
	case strings.HasPrefix(name, "claude-3-5-sonnet") || strings.HasPrefix(name, "claude-3-7-sonnet"):
		anthropicPrice = tokenPrice{InputPerMTok: 3.00, CachedInputPerMTok: 0.30, OutputPerMTok: 15.00}
	}
	if anthropicPrice != (tokenPrice{}) && (strings.Contains(provider, "anthropic") || strings.HasPrefix(name, "claude-")) {
		return anthropicPrice, true
	}
	return tokenPrice{}, false
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

func (r *Runner) executeToolForLoop(ctx context.Context, narratorID string, call tools.Call, messageID string) (tools.Result, error) {
	call = normalizeToolCall(call)
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
	if risk == tools.RiskDanger {
		warning := toolRiskWarning(call.Name, call.Input)
		result := tools.Result{Output: dangerBlockedMessage(warning), IsError: true}
		r.recordImmediateToolResult(ctx, narratorID, messageID, call, risk, result, "denied", warning)
		r.publish(Event{Type: "tool.approval_required", NarratorID: narratorID, Data: approvalEventData(narrator, call, risk, warning, "danger", time.Time{})})
		r.publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": "denied", "risk": risk, "warning": warning}})
		return result, nil
	}
	if r.canAutoExecuteTool(narrator.ID, narrator.PermissionMode, call.Name, risk, call.Input) {
		return r.executeApprovedTool(ctx, narrator, call, tool, risk, messageID, false)
	}
	if !approvalRequired(narrator.PermissionMode, call.Name, risk) {
		result := tools.Result{Output: "tool call denied by permission mode", IsError: true}
		r.recordImmediateToolResult(ctx, narratorID, messageID, call, risk, result, "denied", result.Output)
		r.publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": "denied", "risk": risk}})
		return result, nil
	}
	decision, err := r.waitForToolApproval(ctx, narrator, call, risk, messageID)
	if err != nil {
		return tools.Result{}, err
	}
	if decision.Decision == "deny" {
		message := strings.TrimSpace(decision.Reason)
		if message == "" {
			message = "tool call denied by user"
		}
		result := tools.Result{Output: message, IsError: true}
		r.updatePendingToolResult(ctx, narratorID, call.ID, result, "denied", 0)
		r.publish(Event{Type: "tool.finished", NarratorID: narratorID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": "denied", "risk": risk}})
		return result, nil
	}
	if err := r.store.UpdateToolCallApproval(ctx, narratorID, call.ID, "approved", decision.DecidedBy, "", decision.Reason, ""); err != nil {
		slog.Warn("record tool approval failed", "narratorId", narratorID, "toolUseId", call.ID, "error", err)
	}
	return r.executeApprovedTool(ctx, narrator, call, tool, risk, messageID, true)
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

func (r *Runner) executeApprovedTool(ctx context.Context, narrator db.Narrator, call tools.Call, tool tools.Tool, risk tools.Risk, messageID string, updateExisting bool) (tools.Result, error) {
	r.publish(Event{Type: "tool.started", NarratorID: narrator.ID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "risk": risk}})
	started := time.Now()
	result, err := tool.Execute(ctx, call, tools.Env{NarratorID: narrator.ID, CWD: narrator.CWD})
	duration := time.Since(started).Milliseconds()
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
	output, _ := json.Marshal(result)
	if updateExisting {
		if recordErr := r.store.UpdateToolCallResult(ctx, narrator.ID, call.ID, output, status, duration, errMsg); recordErr != nil {
			slog.Warn("update approved tool call failed", "narratorId", narrator.ID, "toolUseId", call.ID, "error", recordErr)
		}
	} else if _, recordErr := r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narrator.ID, MessageID: messageID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: status, DurationMS: duration, ErrorMessage: errMsg, PermissionDecidedBy: "policy", PermissionDecidedAt: db.Now(), PermissionDecisionReason: autoApprovalReason(call.Name, call.Input)}); recordErr != nil {
		slog.Warn("record tool call failed", "narratorId", narrator.ID, "toolUseId", call.ID, "error", recordErr)
	}
	r.publish(Event{Type: "tool.finished", NarratorID: narrator.ID, Data: map[string]any{"toolUseId": call.ID, "toolName": call.Name, "status": status, "risk": risk, "durationMs": duration}})
	return result, err
}

func (r *Runner) waitForToolApproval(ctx context.Context, narrator db.Narrator, call tools.Call, risk tools.Risk, messageID string) (ToolApprovalDecision, error) {
	command := toolCommand(call.Name, call.Input)
	approval := &pendingApproval{
		NarratorID: narrator.ID,
		ToolUseID:  call.ID,
		ToolName:   call.Name,
		Input:      call.Input,
		Risk:       risk,
		CWD:        narrator.CWD,
		Command:    command,
		Reason:     "exec risk requires approval",
		Warning:    "Bash 命令将访问本地 shell，请确认命令安全后再允许。",
		GrantKey:   sessionGrantKey(call.Name, call.Input),
		ExpiresAt:  time.Now().Add(toolApprovalTimeout),
		Decision:   make(chan ToolApprovalDecision, 1),
	}
	if _, err := r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narrator.ID, MessageID: messageID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, Status: "pending_approval", PermissionDecisionReason: approval.Reason, PermissionSuggestions: approval.Warning}); err != nil {
		return ToolApprovalDecision{}, err
	}
	r.addPendingApproval(approval)
	defer r.removePendingApproval(narrator.ID, call.ID)
	r.publish(Event{Type: "tool.approval_required", NarratorID: narrator.ID, Data: approvalEventData(narrator, call, risk, approval.Warning, approval.Reason, approval.ExpiresAt)})

	timer := time.NewTimer(toolApprovalTimeout)
	defer timer.Stop()
	select {
	case decision := <-approval.Decision:
		if decision.DecidedBy == "" {
			decision.DecidedBy = "user"
		}
		if decision.Decision == "deny" {
			_ = r.store.UpdateToolCallApproval(context.Background(), narrator.ID, call.ID, "denied", decision.DecidedBy, decision.Reason, decision.Reason, approval.Warning)
		}
		return decision, nil
	case <-timer.C:
		decision := ToolApprovalDecision{Decision: "deny", Reason: "tool approval timed out", DecidedBy: "system"}
		_ = r.store.UpdateToolCallApproval(context.Background(), narrator.ID, call.ID, "denied", decision.DecidedBy, decision.Reason, decision.Reason, approval.Warning)
		return decision, nil
	case <-ctx.Done():
		_ = r.store.UpdateToolCallApproval(context.Background(), narrator.ID, call.ID, "denied", "system", "tool approval canceled", "tool approval canceled", approval.Warning)
		return ToolApprovalDecision{}, ctx.Err()
	}
}

func (r *Runner) addPendingApproval(approval *pendingApproval) {
	r.approvalMu.Lock()
	if r.approvals == nil {
		r.approvals = make(map[string]*pendingApproval)
	}
	r.approvals[approvalKey(approval.NarratorID, approval.ToolUseID)] = approval
	r.approvalMu.Unlock()
}

func (r *Runner) removePendingApproval(narratorID, toolUseID string) {
	r.approvalMu.Lock()
	delete(r.approvals, approvalKey(narratorID, toolUseID))
	r.approvalMu.Unlock()
}

func (r *Runner) addSessionGrantLocked(narratorID, grantKey string) {
	if grantKey == "" {
		return
	}
	if r.sessionGrants == nil {
		r.sessionGrants = make(map[string]map[string]struct{})
	}
	if r.sessionGrants[narratorID] == nil {
		r.sessionGrants[narratorID] = make(map[string]struct{})
	}
	r.sessionGrants[narratorID][grantKey] = struct{}{}
}

func (r *Runner) hasSessionGrant(narratorID, grantKey string) bool {
	r.approvalMu.Lock()
	defer r.approvalMu.Unlock()
	_, ok := r.sessionGrants[narratorID][grantKey]
	return ok
}

func approvalKey(narratorID, toolUseID string) string {
	return narratorID + ":" + toolUseID
}

func (r *Runner) canAutoExecuteTool(narratorID, mode, toolName string, risk tools.Risk, input json.RawMessage) bool {
	if allowed(mode, toolName, risk) {
		return true
	}
	if risk != tools.RiskExec || toolName != "Bash" {
		return false
	}
	if mode != "acceptEdits" && mode != "default" && mode != "dontAsk" {
		return false
	}
	command := tools.BashCommand(input)
	if isWhitelistedExecCommand(command) {
		return true
	}
	return r.hasSessionGrant(narratorID, sessionGrantKey(toolName, input))
}

func approvalRequired(mode, toolName string, risk tools.Risk) bool {
	if risk != tools.RiskExec || toolName != "Bash" {
		return false
	}
	switch mode {
	case "acceptEdits", "default", "dontAsk":
		return true
	default:
		return false
	}
}

func (r *Runner) recordImmediateToolResult(ctx context.Context, narratorID, messageID string, call tools.Call, risk tools.Risk, result tools.Result, status, reason string) {
	output, _ := json.Marshal(result)
	if _, err := r.store.AddToolCall(ctx, db.ToolCall{NarratorID: narratorID, MessageID: messageID, ToolUseID: call.ID, ToolName: call.Name, InputJSON: call.Input, OutputJSON: output, Status: status, ErrorMessage: result.Output, PermissionDecidedBy: "policy", PermissionDecidedAt: db.Now(), PermissionDenyMessage: result.Output, PermissionDecisionReason: reason, PermissionSuggestions: reason}); err != nil {
		slog.Warn("record immediate tool result failed", "narratorId", narratorID, "toolUseId", call.ID, "error", err)
	}
}

func (r *Runner) updatePendingToolResult(ctx context.Context, narratorID, toolUseID string, result tools.Result, status string, durationMS int64) {
	output, _ := json.Marshal(result)
	errMsg := ""
	if result.IsError {
		errMsg = result.Output
	}
	if err := r.store.UpdateToolCallResult(ctx, narratorID, toolUseID, output, status, durationMS, errMsg); err != nil {
		slog.Warn("update pending tool result failed", "narratorId", narratorID, "toolUseId", toolUseID, "error", err)
	}
}

func approvalEventData(narrator db.Narrator, call tools.Call, risk tools.Risk, warning, reason string, expiresAt time.Time) map[string]any {
	data := map[string]any{"toolUseId": call.ID, "toolName": call.Name, "risk": risk, "input": json.RawMessage(call.Input), "command": toolCommand(call.Name, call.Input), "cwd": narrator.CWD, "warning": warning, "reason": reason}
	if !expiresAt.IsZero() {
		data["expiresAt"] = expiresAt.Format(time.RFC3339Nano)
	}
	return data
}

func toolCommand(toolName string, input json.RawMessage) string {
	if toolName == "Bash" {
		return tools.BashCommand(input)
	}
	return ""
}

func toolRiskWarning(toolName string, input json.RawMessage) string {
	if toolName == "Bash" {
		return tools.BashDangerWarning(tools.BashCommand(input))
	}
	return "tool risk is blocked by policy"
}

func dangerBlockedMessage(warning string) string {
	if strings.TrimSpace(warning) == "" {
		warning = "dangerous tool call blocked by policy"
	}
	return warning
}

func normalizeToolCall(call tools.Call) tools.Call {
	if call.ID == "" {
		call.ID = db.NewID()
	}
	if len(call.Input) == 0 {
		call.Input = json.RawMessage(`{}`)
	}
	return call
}

func sessionGrantKey(toolName string, input json.RawMessage) string {
	if toolName == "Bash" {
		return toolName + ":" + normalizeShellCommand(tools.BashCommand(input))
	}
	return toolName + ":" + strings.TrimSpace(string(input))
}

func autoApprovalReason(toolName string, input json.RawMessage) string {
	if toolName == "Bash" && isWhitelistedExecCommand(tools.BashCommand(input)) {
		return "auto-approved by built-in exec whitelist"
	}
	return "allowed by permission mode"
}

func isWhitelistedExecCommand(command string) bool {
	command = strings.TrimSpace(command)
	if command == "" || shellCommandIsComplex(command) {
		return false
	}
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return false
	}
	switch fields[0] {
	case "go":
		return len(fields) >= 2 && oneOf(fields[1], "test", "vet", "build")
	case "npm":
		return len(fields) == 2 && fields[1] == "test" || len(fields) == 3 && fields[1] == "run" && oneOf(fields[2], "test", "build", "lint", "check")
	case "pnpm", "yarn", "bun":
		return len(fields) == 2 && oneOf(fields[1], "test", "build", "lint", "check")
	case "git":
		return len(fields) >= 2 && oneOf(fields[1], "status", "diff", "log", "show")
	default:
		return false
	}
}

func shellCommandIsComplex(command string) bool {
	for _, token := range []string{"|", ">", "<", ";", "&&", "||", "$(", "`", "\n"} {
		if strings.Contains(command, token) {
			return true
		}
	}
	return false
}

func normalizeShellCommand(command string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(command)), " ")
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
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
