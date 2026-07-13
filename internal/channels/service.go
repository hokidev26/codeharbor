package channels

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"autoto/internal/db"
	"autoto/internal/runtime"
	"autoto/internal/tools"
)

type parsedCommand struct {
	name   string
	arg    string
	reason string
	valid  bool
	isPair bool
	toolID string
}

type rateWindow struct {
	start time.Time
	count int
}

// Service owns long polling for one resolved Telegram connection.
type Service struct {
	store              Store
	approvals          ApprovalService
	tools              *tools.Registry
	audit              AuditFunc
	connectionID       string
	name               string
	updatedAt          string
	credentialRevision int64
	client             *telegramClient
	retryDelay         time.Duration
	rateLimit          int
	clock              func() time.Time
	onError            func(error)

	mu            sync.RWMutex
	started       bool
	closed        bool
	cancel        context.CancelFunc
	done          chan struct{}
	status        Status
	rateByPairing map[string]rateWindow
}

var _ runtime.Service = (*Service)(nil)

func NewService(config ServiceConfig) (*Service, error) {
	if config.Store == nil || config.Connection.ID == "" || config.Connection.Kind != TelegramKind || !config.Connection.Enabled {
		return nil, ErrInvalidConfig
	}
	token := config.Connection.Secrets["botToken"]
	client, err := newTelegramClient(token, config.APIBase, config.HTTPClient, config.LongPollTimeout, config.RequestTimeout)
	if err != nil {
		return nil, err
	}
	if config.RetryDelay <= 0 {
		config.RetryDelay = DefaultRetryDelay
	}
	if config.RateLimit <= 0 {
		config.RateLimit = DefaultRateLimit
	}
	if config.Clock == nil {
		config.Clock = time.Now
	}
	audit := config.Audit
	if audit == nil {
		audit = func(ctx context.Context, event db.AutomationAuditEvent) error {
			_, err := config.Store.AddAutomationAuditEvent(ctx, event)
			return err
		}
	}
	return &Service{
		store:              config.Store,
		approvals:          config.Approvals,
		tools:              config.Tools,
		audit:              audit,
		connectionID:       config.Connection.ID,
		name:               config.Connection.Name,
		updatedAt:          config.Connection.UpdatedAt,
		credentialRevision: telegramCredentialRevision(token),
		client:             client,
		retryDelay:         config.RetryDelay,
		rateLimit:          config.RateLimit,
		clock:              config.Clock,
		onError:            config.OnError,
		done:               make(chan struct{}),
		rateByPairing:      make(map[string]rateWindow),
		status: Status{
			ConnectionID: config.Connection.ID,
			Name:         config.Connection.Name,
			Kind:         TelegramKind,
		},
	}, nil
}

func telegramCredentialRevision(token string) int64 {
	hash := sha256.Sum256([]byte(token))
	revision := int64(binary.BigEndian.Uint64(hash[:8]) & math.MaxInt64)
	if revision == 0 {
		return 1
	}
	return revision
}

func (s *Service) Start(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidConfig
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrServiceClosed
	}
	if s.started {
		s.mu.Unlock()
		return ErrServiceStarted
	}
	pollCtx, cancel := context.WithCancel(ctx)
	s.started = true
	s.cancel = cancel
	s.status.Running = true
	s.status.StartedAt = s.now().Format(time.RFC3339Nano)
	s.status.LastError = ""
	s.mu.Unlock()

	if err := s.revokeStalePairings(pollCtx); err != nil {
		s.report("stale pairing revocation failed")
	}
	go s.pollLoop(pollCtx)
	return nil
}

func (s *Service) Close(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidConfig
	}
	s.mu.Lock()
	if s.closed {
		done := s.done
		s.mu.Unlock()
		return waitForDone(ctx, done)
	}
	s.closed = true
	cancel := s.cancel
	started := s.started
	if !started {
		close(s.done)
	}
	s.status.Running = false
	done := s.done
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return waitForDone(ctx, done)
}

func waitForDone(ctx context.Context, done <-chan struct{}) error {
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *Service) Send(ctx context.Context, chatID, text string) error {
	s.mu.RLock()
	active := s.started && !s.closed
	s.mu.RUnlock()
	if !active {
		return ErrConnectionNotActive
	}
	if err := s.client.sendMessage(ctx, chatID, text); err != nil {
		s.report("telegram send failed")
		return err
	}
	return nil
}

func (s *Service) pollLoop(ctx context.Context) {
	defer func() {
		s.mu.Lock()
		s.status.Running = false
		close(s.done)
		s.mu.Unlock()
	}()
	cursor, err := s.store.GetChannelCursor(ctx, s.connectionID)
	if err != nil {
		s.report("channel cursor load failed")
		return
	}
	offset := cursor.Offset
	s.setCursor(offset)
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		updates, err := s.client.getUpdates(ctx, offset)
		s.setLastPoll()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.report("telegram polling failed")
			if !waitRetry(ctx, s.retryDelay) {
				return
			}
			continue
		}
		s.clearError()
		sort.Slice(updates, func(i, j int) bool { return updates[i].UpdateID < updates[j].UpdateID })
		for _, update := range updates {
			if update.UpdateID < 0 || update.UpdateID == math.MaxInt64 {
				s.report("invalid telegram update")
				continue
			}
			next := update.UpdateID + 1
			if next <= offset {
				continue
			}
			processedOffset, err := s.recordAndProcess(ctx, update, offset, next)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				s.report("telegram update processing failed")
				cursor, reloadErr := s.store.GetChannelCursor(ctx, s.connectionID)
				if reloadErr == nil && cursor.Offset >= next {
					offset = cursor.Offset
					s.setCursor(offset)
					continue
				}
				if !waitRetry(ctx, s.retryDelay) {
					return
				}
				break
			}
			offset = processedOffset
			s.setCursor(offset)
		}
	}
}

func waitRetry(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) recordAndProcess(ctx context.Context, update telegramUpdate, expectedOffset, nextOffset int64) (int64, error) {
	classification := s.classifyUpdate(ctx, update)
	payload, _ := json.Marshal(map[string]any{
		"direction": "inbound",
		"accepted":  classification.accepted,
		"reason":    classification.reason,
		"command":   classification.command.name,
		"paired":    classification.pairing != nil,
	})
	event := db.ChannelEvent{
		ConnectionID:    s.connectionID,
		ExternalEventID: strconv.FormatInt(update.UpdateID, 10),
		EventType:       classification.eventType,
		AgentID:         pairingAgentID(classification.pairing),
		ToolUseID:       classification.command.toolID,
		ChatID:          classification.chatID,
		UserID:          classification.userID,
		PayloadJSON:     payload,
		OccurredAt:      classification.occurredAt,
	}
	stored, inserted, cursor, err := s.store.RecordChannelEventAndAdvanceCursor(ctx, event, expectedOffset, nextOffset)
	if err != nil {
		return expectedOffset, err
	}
	if !inserted {
		return cursor.Offset, nil
	}
	if classification.accepted {
		_ = s.processClassified(ctx, classification)
	}
	if _, err := s.store.MarkChannelEventProcessed(ctx, stored.ID, s.now().Format(time.RFC3339Nano)); err != nil {
		return cursor.Offset, err
	}
	return cursor.Offset, nil
}

type updateClassification struct {
	accepted   bool
	reason     string
	eventType  string
	chatID     string
	userID     string
	occurredAt string
	text       string
	command    parsedCommand
	pairing    *db.ChannelPairing
}

func (s *Service) classifyUpdate(ctx context.Context, update telegramUpdate) updateClassification {
	result := updateClassification{eventType: "telegram.update.ignored", reason: "unsupported_update"}
	if update.Message == nil {
		return result
	}
	message := update.Message
	result.chatID = strconv.FormatInt(message.Chat.ID, 10)
	if message.From != nil {
		result.userID = strconv.FormatInt(message.From.ID, 10)
	}
	if message.Date > 0 {
		result.occurredAt = time.Unix(message.Date, 0).UTC().Format(time.RFC3339Nano)
	}
	if message.Chat.Type != "private" {
		result.reason = "non_private_chat"
		return result
	}
	if message.Chat.ID <= 0 {
		result.reason = "invalid_chat"
		return result
	}
	if message.From == nil || message.From.ID <= 0 || message.From.IsBot {
		result.reason = "invalid_sender"
		return result
	}
	if message.Text == nil {
		result.reason = "non_text_message"
		return result
	}
	text := *message.Text
	if text == "" || len(text) > MaxTelegramMessageBytes || !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		result.reason = "invalid_text"
		return result
	}
	result.accepted = true
	result.eventType = "telegram.message.received"
	result.reason = "accepted"
	result.text = text
	result.command = parseTelegramCommand(text)
	if pairing, err := s.findActivePairing(ctx, result.chatID, result.userID); err == nil {
		result.pairing = pairing
	} else {
		result.reason = "pairing_lookup_failed"
	}
	return result
}

func pairingAgentID(pairing *db.ChannelPairing) string {
	if pairing == nil {
		return ""
	}
	return pairing.AgentID
}

func parseTelegramCommand(text string) parsedCommand {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || !strings.HasPrefix(trimmed, "/") {
		return parsedCommand{name: "unknown"}
	}
	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return parsedCommand{name: "unknown"}
	}
	switch fields[0] {
	case "/pair":
		if len(fields) == 2 && validCommandArgument(fields[1], 512) {
			return parsedCommand{name: "pair", arg: fields[1], valid: true, isPair: true}
		}
		return parsedCommand{name: "pair", isPair: true}
	case "/status":
		return parsedCommand{name: "status", valid: len(fields) == 1}
	case "/approve":
		if len(fields) == 2 && validCommandArgument(fields[1], 256) {
			return parsedCommand{name: "approve", valid: true, toolID: fields[1]}
		}
		return parsedCommand{name: "approve"}
	case "/deny":
		parts := strings.SplitN(trimmed, " ", 3)
		if len(parts) >= 2 && validCommandArgument(strings.TrimSpace(parts[1]), 256) {
			reason := ""
			if len(parts) == 3 {
				reason = boundedTelegramText(parts[2], 1024)
			}
			return parsedCommand{name: "deny", valid: true, toolID: strings.TrimSpace(parts[1]), reason: reason}
		}
		return parsedCommand{name: "deny"}
	default:
		return parsedCommand{name: "unknown"}
	}
}

func validCommandArgument(value string, maximum int) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= maximum && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n\t")
}

func (s *Service) processClassified(ctx context.Context, update updateClassification) error {
	command := update.command
	if update.pairing == nil {
		if command.isPair {
			return s.handlePair(ctx, update, command)
		}
		_ = s.recordAudit(ctx, db.AutomationAuditEvent{
			Category: "channel", Action: "telegram.unpaired_message", Actor: channelActor(update.userID),
			SubjectType: "integration_connection", SubjectID: s.connectionID, Outcome: "denied", Risk: "low",
			DetailsJSON: auditDetails(map[string]any{"connectionId": s.connectionID, "chatId": update.chatID, "userId": update.userID, "command": command.name}),
		})
		return nil
	}
	if !s.allowPairingMessage(update.pairing.ID) {
		if err := s.recordAudit(ctx, db.AutomationAuditEvent{
			Category: "channel", Action: "telegram.rate_limited", Actor: channelActor(update.userID), AgentID: update.pairing.AgentID,
			SubjectType: "channel_pairing", SubjectID: update.pairing.ID, Outcome: "denied", Risk: "low",
			DetailsJSON: auditDetails(map[string]any{"connectionId": s.connectionID, "chatId": update.chatID, "userId": update.userID}),
		}); err == nil {
			_ = s.client.sendMessage(ctx, update.chatID, "Rate limit exceeded. Try again later.")
		}
		return nil
	}
	if !command.valid {
		return s.client.sendMessage(ctx, update.chatID, "Unsupported command.")
	}
	switch command.name {
	case "pair":
		return s.client.sendMessage(ctx, update.chatID, "This chat is already paired.")
	case "status":
		return s.handleStatus(ctx, update)
	case "approve":
		return s.handleDecision(ctx, update, command, true)
	case "deny":
		return s.handleDecision(ctx, update, command, false)
	default:
		return s.client.sendMessage(ctx, update.chatID, "Unsupported command.")
	}
}

func (s *Service) handlePair(ctx context.Context, update updateClassification, command parsedCommand) error {
	if !command.valid {
		return nil
	}
	pairings, err := s.store.ListChannelPairings(ctx, db.ChannelPairingListOptions{ConnectionID: s.connectionID, Status: "pending", Limit: 50})
	if err != nil {
		return err
	}
	candidates := s.selectPendingPairings(pairings)
	if len(candidates) == 0 {
		_ = s.recordAudit(ctx, db.AutomationAuditEvent{
			Category: "channel", Action: "telegram.pair", Actor: channelActor(update.userID),
			SubjectType: "integration_connection", SubjectID: s.connectionID, Outcome: "denied", Risk: "medium",
			DetailsJSON: auditDetails(map[string]any{"connectionId": s.connectionID, "chatId": update.chatID, "userId": update.userID, "reason": "no_pending_pairing"}),
		})
		return nil
	}
	hash := sha256.Sum256([]byte(command.arg))
	codeHash := hex.EncodeToString(hash[:])
	pending := candidates[0]
	matches := false
	for index := range candidates {
		candidateMatches := subtle.ConstantTimeCompare([]byte(candidates[index].CodeHash), []byte(codeHash)) == 1
		if candidateMatches && !matches {
			pending = candidates[index]
		}
		matches = matches || candidateMatches
	}
	if !s.allowPairingMessage(pending.ID) {
		return nil
	}
	outcome := "denied"
	reason := "code_mismatch"
	if matches {
		outcome = "unknown"
		reason = "activation_requested"
	}
	if err := s.recordAudit(ctx, db.AutomationAuditEvent{
		Category: "channel", Action: "telegram.pair", Actor: channelActor(update.userID), AgentID: pending.AgentID,
		SubjectType: "channel_pairing", SubjectID: pending.ID, Outcome: outcome, Risk: "medium",
		DetailsJSON: auditDetails(map[string]any{"connectionId": s.connectionID, "chatId": update.chatID, "userId": update.userID, "reason": reason}),
	}); err != nil {
		return ErrAuditRequired
	}
	if !matches {
		_, _ = s.store.RecordChannelPairingFailure(ctx, pending.ID, db.DefaultPairingMaxFailedAttempts, s.now().Add(db.DefaultPairingLockDuration).Format(time.RFC3339Nano))
		return nil
	}
	if _, err := s.store.ActivateChannelPairing(ctx, pending.ID, codeHash, update.chatID, update.userID, s.credentialRevision); err != nil {
		return nil
	}
	return s.client.sendMessage(ctx, update.chatID, "Pairing complete.")
}

func (s *Service) selectPendingPairings(pairings []db.ChannelPairing) []db.ChannelPairing {
	now := s.now()
	selected := make([]db.ChannelPairing, 0, len(pairings))
	for _, pairing := range pairings {
		expiresAt, expiresErr := time.Parse(time.RFC3339Nano, pairing.ExpiresAt)
		if expiresErr != nil || !expiresAt.After(now) {
			continue
		}
		if pairing.LockedUntil != "" {
			lockedUntil, lockErr := time.Parse(time.RFC3339Nano, pairing.LockedUntil)
			if lockErr == nil && lockedUntil.After(now) {
				continue
			}
		}
		selected = append(selected, pairing)
	}
	return selected
}

func (s *Service) handleStatus(ctx context.Context, update updateClassification) error {
	agentRecord, err := s.store.GetAgent(ctx, update.pairing.AgentID)
	if err != nil {
		return s.client.sendMessage(ctx, update.chatID, "Status is unavailable.")
	}
	runs, runErr := s.store.ListRuns(ctx, agentRecord.ID, 1)
	pending, pendingErr := s.store.ListPendingToolCalls(ctx, agentRecord.ID)
	if runErr != nil || pendingErr != nil {
		return s.client.sendMessage(ctx, update.chatID, "Status is unavailable.")
	}
	recentRun := "none"
	if len(runs) > 0 {
		recentRun = runs[0].Status
	}
	text := fmt.Sprintf("Agent: %s\nStatus: %s\nRecent run: %s\nPending approvals: %d", agentRecord.Title, agentRecord.Status, recentRun, len(pending))
	return s.client.sendMessage(ctx, update.chatID, text)
}

func (s *Service) handleDecision(ctx context.Context, update updateClassification, command parsedCommand, approve bool) error {
	call, err := s.store.GetToolCallByUseID(ctx, update.pairing.AgentID, command.toolID)
	if err != nil || call.Status != "pending_approval" {
		return s.client.sendMessage(ctx, update.chatID, "Pending tool use was not found.")
	}
	if s.tools == nil || s.approvals == nil {
		return s.client.sendMessage(ctx, update.chatID, "Decision was not applied.")
	}
	tool, ok := s.tools.Get(call.ToolName)
	if !ok {
		return s.client.sendMessage(ctx, update.chatID, "Decision was not applied.")
	}
	risk := tool.Risk(call.InputJSON)
	decision := "deny"
	reason := command.reason
	if approve && risk != tools.RiskDanger {
		decision = "allow_once"
		reason = "approved from Telegram"
	} else if approve {
		reason = "dangerous tool use cannot be approved from Telegram"
	} else if reason == "" {
		reason = "denied from Telegram"
	}
	outcome := "unknown"
	if risk == tools.RiskDanger || !approve {
		outcome = "denied"
	}
	action := "telegram.tool_approval"
	if decision == "deny" {
		action = "telegram.tool_denial"
	}
	if err := s.recordAudit(ctx, db.AutomationAuditEvent{
		Category: "channel", Action: action, Actor: channelActor(update.userID), AgentID: call.AgentID, RunID: call.RunID,
		SubjectType: "tool_use", SubjectID: call.ToolUseID, Outcome: outcome, Risk: auditRisk(risk),
		DetailsJSON: auditDetails(map[string]any{
			"connectionId": s.connectionID, "chatId": update.chatID, "userId": update.userID,
			"decision": decision, "risk": string(risk), "permissionGeneration": call.PermissionGeneration, "policyGeneration": call.PolicyGeneration,
		}),
	}); err != nil {
		return s.client.sendMessage(ctx, update.chatID, "Decision was not applied.")
	}
	accepted, err := s.approvals.ApproveToolCall(ctx, call.AgentID, call.ToolUseID, ApprovalDecision{
		Decision: decision, Reason: reason, DecidedBy: channelActor(update.userID),
		PermissionGeneration: call.PermissionGeneration, PolicyGeneration: call.PolicyGeneration,
	})
	if err != nil || !accepted {
		return s.client.sendMessage(ctx, update.chatID, "Decision was not applied.")
	}
	if decision == "allow_once" {
		return s.client.sendMessage(ctx, update.chatID, "Tool use approved once.")
	}
	if risk == tools.RiskDanger && approve {
		return s.client.sendMessage(ctx, update.chatID, "Dangerous tool use was denied.")
	}
	return s.client.sendMessage(ctx, update.chatID, "Tool use denied.")
}

func (s *Service) findActivePairing(ctx context.Context, chatID, userID string) (*db.ChannelPairing, error) {
	pairings, err := s.store.ListChannelPairings(ctx, db.ChannelPairingListOptions{ConnectionID: s.connectionID, Status: "active", Limit: 200})
	if err != nil {
		return nil, err
	}
	for index := range pairings {
		pairing := &pairings[index]
		if pairing.ChatID == chatID && pairing.UserID == userID && pairing.CredentialRevision == s.credentialRevision {
			return pairing, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (s *Service) revokeStalePairings(ctx context.Context) error {
	pairings, err := s.store.ListChannelPairings(ctx, db.ChannelPairingListOptions{ConnectionID: s.connectionID, Status: "active", Limit: 200})
	if err != nil {
		return err
	}
	var errs []error
	for _, pairing := range pairings {
		if pairing.CredentialRevision == s.credentialRevision {
			continue
		}
		if err := s.recordAudit(ctx, db.AutomationAuditEvent{
			Category: "channel", Action: "telegram.pairing_revoked", Actor: "system", AgentID: pairing.AgentID,
			SubjectType: "channel_pairing", SubjectID: pairing.ID, Outcome: "denied", Risk: "high",
			DetailsJSON: auditDetails(map[string]any{"connectionId": s.connectionID, "reason": "bot_secret_changed"}),
		}); err != nil {
			errs = append(errs, ErrAuditRequired)
			continue
		}
		if _, err := s.store.RevokeChannelPairing(ctx, pairing.ID); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *Service) recordAudit(ctx context.Context, event db.AutomationAuditEvent) error {
	if event.CreatedAt == "" {
		event.CreatedAt = s.now().Format(time.RFC3339Nano)
	}
	if err := s.audit(ctx, event); err != nil {
		s.report("required channel audit failed")
		return ErrAuditRequired
	}
	return nil
}

func auditDetails(details map[string]any) json.RawMessage {
	encoded, err := json.Marshal(details)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return encoded
}

func channelActor(userID string) string {
	return "channel:telegram:" + userID
}

func auditRisk(risk tools.Risk) string {
	switch risk {
	case tools.RiskRead:
		return "low"
	case tools.RiskWrite:
		return "medium"
	case tools.RiskExec:
		return "high"
	case tools.RiskDanger:
		return "critical"
	default:
		return "none"
	}
}

func (s *Service) allowPairingMessage(pairingID string) bool {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	window := s.rateByPairing[pairingID]
	if window.start.IsZero() || !now.Before(window.start.Add(time.Minute)) {
		window = rateWindow{start: now}
	}
	if window.count >= s.rateLimit {
		s.rateByPairing[pairingID] = window
		return false
	}
	window.count++
	s.rateByPairing[pairingID] = window
	if len(s.rateByPairing) > 1024 {
		for id, candidate := range s.rateByPairing {
			if now.Sub(candidate.start) > 2*time.Minute {
				delete(s.rateByPairing, id)
			}
		}
	}
	return true
}

func (s *Service) now() time.Time {
	return s.clock().UTC()
}

func (s *Service) setCursor(offset int64) {
	s.mu.Lock()
	s.status.Cursor = offset
	s.mu.Unlock()
}

func (s *Service) setLastPoll() {
	s.mu.Lock()
	s.status.LastPollAt = s.now().Format(time.RFC3339Nano)
	s.mu.Unlock()
}

func (s *Service) clearError() {
	s.mu.Lock()
	s.status.LastError = ""
	s.mu.Unlock()
}

func (s *Service) report(message string) {
	err := errors.New("channels: " + message)
	s.mu.Lock()
	s.status.LastError = message
	s.mu.Unlock()
	if s.onError != nil {
		s.onError(err)
	}
}
