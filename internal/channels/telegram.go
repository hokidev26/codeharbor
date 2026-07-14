package channels

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type telegramClient struct {
	base           url.URL
	botToken       string
	httpClient     *http.Client
	longPoll       time.Duration
	requestTimeout time.Duration
}

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message,omitempty"`
}

type telegramMessage struct {
	MessageID int64         `json:"message_id"`
	Date      int64         `json:"date"`
	Chat      telegramChat  `json:"chat"`
	From      *telegramUser `json:"from,omitempty"`
	Text      *string       `json:"text,omitempty"`
}

type telegramChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type telegramUser struct {
	ID    int64 `json:"id"`
	IsBot bool  `json:"is_bot"`
}

type telegramEnvelope[T any] struct {
	OK     bool `json:"ok"`
	Result T    `json:"result"`
}

func newTelegramClient(connectionToken, rawBase string, injected *http.Client, longPoll, requestTimeout time.Duration) (*telegramClient, error) {
	if !validBotToken(connectionToken) {
		return nil, ErrInvalidConfig
	}
	base, err := parseTelegramBase(rawBase)
	if err != nil {
		return nil, err
	}
	if injected == nil {
		injected = &http.Client{}
	}
	client := *injected
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	if longPoll <= 0 {
		longPoll = DefaultLongPollTimeout
	}
	if longPoll > 50*time.Second {
		longPoll = 50 * time.Second
	}
	if requestTimeout <= 0 {
		requestTimeout = DefaultRequestTimeout
	}
	if requestTimeout <= longPoll {
		requestTimeout = longPoll + 5*time.Second
	}
	return &telegramClient{
		base:           base,
		botToken:       connectionToken,
		httpClient:     &client,
		longPoll:       longPoll,
		requestTimeout: requestTimeout,
	}, nil
}

func parseTelegramBase(raw string) (url.URL, error) {
	if raw == "" {
		raw = DefaultTelegramAPIBase
	}
	if raw != strings.TrimSpace(raw) || strings.ContainsAny(raw, "\r\n") {
		return url.URL{}, ErrInvalidConfig
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" {
		return url.URL{}, ErrInvalidConfig
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return url.URL{}, ErrInvalidConfig
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return url.URL{}, ErrInvalidConfig
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return url.URL{}, ErrInvalidConfig
	}
	if raw == DefaultTelegramAPIBase && (parsed.Scheme != "https" || parsed.Host != "api.telegram.org") {
		return url.URL{}, ErrInvalidConfig
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return *parsed, nil
}

func validBotToken(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 512 || strings.ContainsAny(value, "\r\n/") {
		return false
	}
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || strings.ContainsRune(":_-", char) {
			continue
		}
		return false
	}
	return true
}

func (c *telegramClient) getUpdates(ctx context.Context, offset int64) ([]telegramUpdate, error) {
	if c == nil || c.httpClient == nil || offset < 0 {
		return nil, ErrTelegramRequest
	}
	seconds := int(c.longPoll / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	payload := struct {
		Offset         int64    `json:"offset"`
		Timeout        int      `json:"timeout"`
		Limit          int      `json:"limit"`
		AllowedUpdates []string `json:"allowed_updates"`
	}{Offset: offset, Timeout: seconds, Limit: 100, AllowedUpdates: []string{"message"}}
	var envelope telegramEnvelope[[]telegramUpdate]
	if err := c.request(ctx, "getUpdates", payload, MaxTelegramResponseBytes, c.requestTimeout, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Result) > 100 {
		return nil, ErrTelegramResponse
	}
	return envelope.Result, nil
}

func (c *telegramClient) sendMessage(ctx context.Context, chatID, text string) error {
	chatID = strings.TrimSpace(chatID)
	text = boundedTelegramText(text, MaxTelegramSendBytes)
	if chatID == "" || len(chatID) > 64 || text == "" {
		return ErrTelegramRequest
	}
	parsedChatID, err := strconv.ParseInt(chatID, 10, 64)
	if err != nil || parsedChatID == 0 {
		return ErrTelegramRequest
	}
	payload := struct {
		ChatID                string `json:"chat_id"`
		Text                  string `json:"text"`
		DisableWebPagePreview bool   `json:"disable_web_page_preview"`
	}{ChatID: chatID, Text: text, DisableWebPagePreview: true}
	var envelope telegramEnvelope[json.RawMessage]
	timeout := c.requestTimeout
	if timeout > 10*time.Second {
		timeout = 10 * time.Second
	}
	return c.request(ctx, "sendMessage", payload, 64<<10, timeout, &envelope)
}

func (c *telegramClient) request(ctx context.Context, method string, payload any, maxResponse int64, timeout time.Duration, target any) error {
	encoded, err := json.Marshal(payload)
	if err != nil || len(encoded) > 16<<10 {
		return ErrTelegramRequest
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, c.methodURL(method), bytes.NewReader(encoded))
	if err != nil {
		return ErrTelegramRequest
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return ErrTelegramRequest
	}
	defer response.Body.Close()
	body, tooLarge, err := readTelegramBody(response.Body, maxResponse)
	if err != nil {
		return ErrTelegramRequest
	}
	if tooLarge {
		return ErrTelegramTooLarge
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrTelegramRejected
	}
	if len(bytes.TrimSpace(body)) == 0 || json.Unmarshal(body, target) != nil {
		return ErrTelegramResponse
	}
	switch envelope := target.(type) {
	case *telegramEnvelope[[]telegramUpdate]:
		if !envelope.OK {
			return ErrTelegramRejected
		}
	case *telegramEnvelope[json.RawMessage]:
		if !envelope.OK {
			return ErrTelegramRejected
		}
	default:
		return ErrTelegramResponse
	}
	return nil
}

func (c *telegramClient) methodURL(method string) string {
	base := c.base
	base.Path = "/bot" + c.botToken + "/" + method
	base.RawPath = ""
	return base.String()
}

func readTelegramBody(reader io.Reader, maximum int64) ([]byte, bool, error) {
	if maximum <= 0 {
		return nil, false, errors.New("invalid response bound")
	}
	body, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(body)) > maximum {
		return body[:maximum], true, nil
	}
	return body, false, nil
}

func boundedTelegramText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if value == "" || maximum <= 0 {
		return ""
	}
	if len(value) <= maximum {
		return value
	}
	value = value[:maximum]
	for !utf8.ValidString(value) && len(value) > 0 {
		value = value[:len(value)-1]
	}
	return strings.TrimSpace(value)
}
