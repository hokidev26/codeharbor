package devices

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"autoto/internal/integrations"
)

const (
	RequestTimeout          = 5 * time.Second
	MaxListResponseBytes    = 1 << 20
	MaxExecuteResponseBytes = 256 << 10

	maxSummaryStringBytes   = 512
	maxAttributeStringBytes = 256
)

// Client is a Home Assistant adapter. All fields are private so resolved secret
// material cannot be serialized accidentally.
type Client struct {
	endpoint    url.URL
	accessToken string
	httpClient  *http.Client
}

var _ Adapter = (*Client)(nil)

// NewClient validates a resolved Home Assistant connection and clones the
// injected HTTP client. Redirects are disabled so the bearer token cannot leave
// the configured endpoint through a redirect.
func NewClient(connection integrations.ResolvedConnection, injected *http.Client) (*Client, error) {
	if connection.Kind != HomeAssistantKind {
		return nil, ErrInvalidConnection
	}
	if injected == nil {
		return nil, ErrInvalidConnection
	}

	endpoint, err := parseEndpoint(connection.Endpoint)
	if err != nil {
		return nil, err
	}
	accessToken, ok := connection.Secrets["accessToken"]
	if !ok || accessToken == "" || accessToken != strings.TrimSpace(accessToken) || strings.ContainsAny(accessToken, "\r\n") {
		return nil, ErrMissingAccessToken
	}

	httpClient := *injected
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Client{endpoint: endpoint, accessToken: accessToken, httpClient: &httpClient}, nil
}

// NewAdapter returns the server-facing interface.
func NewAdapter(connection integrations.ResolvedConnection, injected *http.Client) (Adapter, error) {
	return NewClient(connection, injected)
}

// NewHomeAssistantAdapter is an explicit constructor alias.
func NewHomeAssistantAdapter(connection integrations.ResolvedConnection, injected *http.Client) (Adapter, error) {
	return NewClient(connection, injected)
}

func parseEndpoint(raw string) (url.URL, error) {
	if raw == "" || raw != strings.TrimSpace(raw) || strings.Contains(raw, "#") {
		return url.URL{}, ErrInvalidEndpoint
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Hostname() == "" {
		return url.URL{}, ErrInvalidEndpoint
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return url.URL{}, ErrInvalidEndpoint
	}
	return *parsed, nil
}

// String and GoString deliberately expose no endpoint internals or credential.
func (c Client) String() string {
	return "HomeAssistantClient{redacted}"
}

func (c Client) GoString() string {
	return c.String()
}

// MarshalJSON is stable and secret-free even if Client gains exported fields in
// the future.
func (c Client) MarshalJSON() ([]byte, error) {
	return []byte(`{"kind":"home-assistant"}`), nil
}

func (c *Client) ValidateAction(action Action) error {
	return ValidateAction(action)
}

func (c *Client) CanonicalAction(action Action) (Action, error) {
	return CanonicalAction(action)
}

func (c *Client) Risk(action Action) RiskLevel {
	return Risk(action)
}

// ListEntities fetches /api/states and returns only public, whitelisted data.
func (c *Client) ListEntities(ctx context.Context) ([]Entity, error) {
	if c == nil || c.httpClient == nil || ctx == nil {
		return nil, ErrRequestFailed
	}
	requestCtx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, c.endpointURL("/api/states"), nil)
	if err != nil {
		return nil, ErrRequestFailed
	}
	c.setHeaders(request, false)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, ErrRequestFailed
	}
	defer response.Body.Close()

	body, tooLarge, readErr := readBounded(response.Body, MaxListResponseBytes)
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, ErrRemoteRejected
	}
	if readErr != nil {
		return nil, ErrRequestFailed
	}
	if tooLarge {
		return nil, ErrResponseTooLarge
	}
	return c.decodeStates(body)
}

// ListDevices is the adapter-neutral alias for ListEntities.
func (c *Client) ListDevices(ctx context.Context) ([]Device, error) {
	return c.ListEntities(ctx)
}

// Execute accepts only an unchanged Action returned by CanonicalAction.
func (c *Client) Execute(ctx context.Context, action Action) error {
	if c == nil || c.httpClient == nil || ctx == nil {
		return ErrRequestFailed
	}
	if !IsCanonicalAction(action) {
		return ErrActionNotCanonical
	}
	if err := ValidateAction(action); err != nil {
		return ErrActionNotCanonical
	}

	requestCtx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	path := "/api/services/" + action.Domain + "/" + action.Service
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, c.endpointURL(path), bytes.NewReader(action.Input))
	if err != nil {
		return ErrRequestFailed
	}
	c.setHeaders(request, true)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return ErrRequestFailed
	}
	defer response.Body.Close()

	_, tooLarge, readErr := readBounded(response.Body, MaxExecuteResponseBytes)
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrRemoteRejected
	}
	if readErr != nil {
		return ErrRequestFailed
	}
	if tooLarge {
		return ErrResponseTooLarge
	}
	return nil
}

func (c *Client) endpointURL(suffix string) string {
	endpoint := c.endpoint
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + suffix
	endpoint.RawPath = ""
	return endpoint.String()
}

func (c *Client) setHeaders(request *http.Request, hasJSONBody bool) {
	request.Header.Set("Authorization", "Bearer "+c.accessToken)
	request.Header.Set("Accept", "application/json")
	if hasJSONBody {
		request.Header.Set("Content-Type", "application/json")
	}
}

func readBounded(reader io.Reader, maximum int64) ([]byte, bool, error) {
	body, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, false, ErrRequestFailed
	}
	if int64(len(body)) > maximum {
		return body[:maximum], true, nil
	}
	return body, false, nil
}

type homeAssistantState struct {
	EntityID   string                     `json:"entity_id"`
	State      string                     `json:"state"`
	Attributes map[string]json.RawMessage `json:"attributes"`
}

func (c *Client) decodeStates(body []byte) ([]Entity, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return nil, ErrInvalidResponse
	}
	var states []homeAssistantState
	if err := json.Unmarshal(trimmed, &states); err != nil {
		return nil, ErrInvalidResponse
	}
	entities := make([]Entity, 0, len(states))
	for _, state := range states {
		domain, ok := splitEntityID(state.EntityID)
		if !ok || len(state.State) > maxSummaryStringBytes || strings.Contains(state.EntityID, c.accessToken) {
			continue
		}
		publicState := c.safeResponseString(state.State, "unknown")
		attributes := c.publicAttributes(state.Attributes)
		name := state.EntityID
		if friendlyName, ok := attributes["friendly_name"].(string); ok && strings.TrimSpace(friendlyName) != "" {
			name = friendlyName
		}
		entities = append(entities, Entity{
			ID:         state.EntityID,
			Name:       name,
			Domain:     domain,
			State:      publicState,
			Attributes: attributes,
		})
	}
	return entities, nil
}

type attributeValueKind uint8

const (
	attributeNumber attributeValueKind = iota
	attributeString
	attributeBoolean
)

var publicAttributeKinds = map[string]attributeValueKind{
	"brightness":          attributeNumber,
	"temperature":         attributeNumber,
	"current_temperature": attributeNumber,
	"target_temp_high":    attributeNumber,
	"target_temp_low":     attributeNumber,
	"min_temp":            attributeNumber,
	"max_temp":            attributeNumber,
	"target_temp_step":    attributeNumber,
	"current_position":    attributeNumber,
	"position":            attributeNumber,
	"percentage":          attributeNumber,
	"battery_level":       attributeNumber,
	"humidity":            attributeNumber,
	"current_humidity":    attributeNumber,
	"supported_features":  attributeNumber,
	"unit":                attributeString,
	"unit_of_measurement": attributeString,
	"device_class":        attributeString,
	"friendly_name":       attributeString,
	"hvac_action":         attributeString,
	"preset_mode":         attributeString,
	"mode":                attributeString,
	"assumed_state":       attributeBoolean,
}

func (c *Client) publicAttributes(attributes map[string]json.RawMessage) map[string]any {
	public := make(map[string]any)
	for key, raw := range attributes {
		kind, allowed := publicAttributeKinds[key]
		if !allowed {
			continue
		}
		switch kind {
		case attributeNumber:
			var value float64
			if err := json.Unmarshal(raw, &value); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
				public[key] = value
			}
		case attributeString:
			var value string
			if err := json.Unmarshal(raw, &value); err == nil && len(value) <= maxAttributeStringBytes && !strings.Contains(value, c.accessToken) {
				public[key] = value
			}
		case attributeBoolean:
			var value bool
			if err := json.Unmarshal(raw, &value); err == nil {
				public[key] = value
			}
		}
	}
	return public
}

func (c *Client) safeResponseString(value, fallback string) string {
	if strings.Contains(value, c.accessToken) {
		return fallback
	}
	return value
}
