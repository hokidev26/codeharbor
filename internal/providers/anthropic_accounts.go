package providers

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"autoto/internal/anthropicauth"
)

type anthropicAccountCandidate struct {
	id       string
	priority int
	client   anthropic.Client
}

func (p *AnthropicProvider) SetAccountTelemetry(telemetry AccountTelemetry) {
	if p == nil {
		return
	}
	p.telemetry = telemetry
	if quotaTelemetry, ok := telemetry.(AccountQuotaTelemetry); ok {
		p.quotaTelemetry = quotaTelemetry
	}
}

func (p *AnthropicProvider) SetAccountQuotaTelemetry(telemetry AccountQuotaTelemetry) {
	if p != nil {
		p.quotaTelemetry = telemetry
	}
}

func (p *AnthropicProvider) accountCandidates() ([]anthropicAccountCandidate, error) {
	if p == nil {
		return nil, providerUnavailableError(anthropicauth.DefaultProviderName, "provider is not configured")
	}
	var items []anthropicauth.StoredCredential
	var loadErr error
	if p.store != nil && strings.TrimSpace(p.cfg.CredentialStorePath) != "" {
		items, loadErr = p.store.Load()
	}
	candidates := make([]anthropicAccountCandidate, 0, len(items)+1)
	for index := range items {
		item := items[index]
		if item.Credential.Disabled {
			continue
		}
		client, err := p.clientForCredential(item.Credential)
		if err != nil {
			continue
		}
		candidates = append(candidates, anthropicAccountCandidate{
			id:       item.Credential.ID,
			priority: item.Credential.Priority,
			client:   client,
		})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].priority != candidates[j].priority {
			return candidates[i].priority < candidates[j].priority
		}
		return candidates[i].id < candidates[j].id
	})
	if strings.TrimSpace(p.cfg.APIKey) != "" && !managedAnthropicAPIKeyExists(items, p.cfg.APIKey) {
		candidates = append(candidates, anthropicAccountCandidate{
			id:       "configured",
			priority: int(^uint(0) >> 1),
			client:   p.newAnthropicClient(option.WithAPIKey(p.cfg.APIKey)),
		})
	}
	if len(candidates) > 0 {
		return candidates, nil
	}
	if loadErr != nil {
		return nil, providerUnavailableError(p.cfg.Name, "Anthropic 本地凭据库不可用")
	}
	return nil, providerUnavailableError(p.cfg.Name, "Anthropic credentials are not configured")
}

func managedAnthropicAPIKeyExists(items []anthropicauth.StoredCredential, configuredKey string) bool {
	configuredKey = strings.TrimSpace(configuredKey)
	for _, item := range items {
		credential := item.Credential
		if credential.Disabled || credential.AuthType != anthropicauth.AuthTypeAPIKey || len(credential.APIKey) != len(configuredKey) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(credential.APIKey), []byte(configuredKey)) == 1 {
			return true
		}
	}
	return false
}

func (p *AnthropicProvider) clientForCredential(credential anthropicauth.Credential) (anthropic.Client, error) {
	switch credential.AuthType {
	case anthropicauth.AuthTypeProfile:
		if strings.TrimSpace(credential.Profile) == "" {
			return anthropic.Client{}, errors.New("Anthropic profile is empty")
		}
		return p.newAnthropicClient(option.WithProfile(credential.Profile)), nil
	case anthropicauth.AuthTypeAPIKey:
		if strings.TrimSpace(credential.APIKey) == "" {
			return anthropic.Client{}, errors.New("Anthropic API key is empty")
		}
		return p.newAnthropicClient(option.WithAPIKey(credential.APIKey)), nil
	default:
		return anthropic.Client{}, errors.New("Anthropic auth type is invalid")
	}
}

func (p *AnthropicProvider) newAnthropicClient(auth option.RequestOption) anthropic.Client {
	opts := []option.RequestOption{
		option.WithoutEnvironmentDefaults(),
		option.WithHTTPClient(providerHTTPClient(90 * time.Second)),
		option.WithMaxRetries(0),
		auth,
	}
	if p != nil && strings.TrimSpace(p.cfg.BaseURL) != "" {
		opts = append(opts, option.WithBaseURL(p.cfg.BaseURL))
	}
	return anthropic.NewClient(opts...)
}

func (p *AnthropicProvider) SyncAccount(ctx context.Context, id string) (anthropicauth.AccountSummary, []string, ProviderAccountQuotaSnapshot, error) {
	if p == nil || p.store == nil {
		return anthropicauth.AccountSummary{}, nil, ProviderAccountQuotaSnapshot{}, providerUnavailableError(anthropicauth.DefaultProviderName, "本地凭据库未配置")
	}
	if p.configErr != nil {
		return anthropicauth.AccountSummary{}, nil, ProviderAccountQuotaSnapshot{}, p.configErr
	}
	if err := ctx.Err(); err != nil {
		return anthropicauth.AccountSummary{}, nil, ProviderAccountQuotaSnapshot{}, err
	}
	item, err := p.store.GetByID(id)
	if err != nil {
		return anthropicauth.AccountSummary{}, nil, ProviderAccountQuotaSnapshot{}, err
	}
	client, err := p.clientForCredential(item.Credential)
	if err != nil {
		return anthropicauth.AccountSummary{}, nil, ProviderAccountQuotaSnapshot{}, providerUnavailableError(p.cfg.Name, "Anthropic account credential is invalid")
	}
	models, response, err := p.listModelsWithClient(ctx, client)
	quota := anthropicQuotaSnapshot(p.cfg.Name, item.Credential.ID, response, p.now())
	quota.Models = append([]string(nil), models...)
	p.recordAccountQuota(ctx, quota)
	if err != nil {
		return anthropicauth.Summary(item), nil, quota, sanitizeAnthropicError(ctx, p.cfg.Name, err)
	}
	return anthropicauth.Summary(item), models, quota, nil
}

func (p *AnthropicProvider) listModelsWithClient(ctx context.Context, client anthropic.Client) ([]string, *http.Response, error) {
	var response *http.Response
	page, err := client.Models.List(ctx, anthropic.ModelListParams{}, option.WithResponseInto(&response))
	if err != nil {
		if apiErr := anthropicAPIError(err); apiErr != nil && apiErr.Response != nil {
			response = apiErr.Response
		}
		return nil, response, err
	}
	models := make([]string, 0, len(page.Data))
	for _, model := range page.Data {
		if id := strings.TrimSpace(model.ID); id != "" {
			models = append(models, id)
		}
	}
	return models, response, nil
}

func (p *AnthropicProvider) recordAccountAttempt(ctx context.Context, accountID string, success bool, httpStatus int, err error) {
	if p == nil || p.telemetry == nil || strings.TrimSpace(accountID) == "" || ctx == nil || ctx.Err() != nil {
		return
	}
	status, errorType := anthropicErrorMetadata(err)
	if httpStatus > 0 {
		status = httpStatus
	}
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_ = p.telemetry.RecordProviderAccountAttempt(recordCtx, ProviderAccountAttempt{
		Provider:    p.cfg.Name,
		AccountID:   accountID,
		Success:     success,
		HTTPStatus:  status,
		StatusCode:  safeTelemetryCode(http.StatusText(status), ""),
		ErrorCode:   safeTelemetryCode(errorType, ""),
		AttemptedAt: p.now().UTC(),
	})
}

func (p *AnthropicProvider) recordAccountQuota(ctx context.Context, snapshot ProviderAccountQuotaSnapshot) {
	if p == nil || p.quotaTelemetry == nil || strings.TrimSpace(snapshot.AccountID) == "" || ctx == nil || ctx.Err() != nil || snapshot.FetchedAt.IsZero() || !hasAnthropicQuotaData(snapshot) {
		return
	}
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_ = p.quotaTelemetry.UpdateProviderAccountQuota(recordCtx, snapshot.Provider, snapshot.AccountID, snapshot, snapshot.FetchedAt)
}

func hasAnthropicQuotaData(snapshot ProviderAccountQuotaSnapshot) bool {
	limits := []AccountRateLimitSnapshot{snapshot.Requests, snapshot.InputTokens, snapshot.OutputTokens}
	for _, limit := range limits {
		if limit.Limit != "" || limit.Remaining != "" || limit.Reset != "" {
			return true
		}
	}
	return snapshot.RetryAfter != "" || len(snapshot.Models) > 0
}

func (p *AnthropicProvider) now() time.Time {
	if p != nil && p.clock != nil {
		return p.clock()
	}
	return time.Now()
}

func anthropicResponseStatus(response *http.Response) int {
	if response == nil {
		return 0
	}
	return response.StatusCode
}

func anthropicQuotaSnapshot(provider, accountID string, response *http.Response, fetchedAt time.Time) ProviderAccountQuotaSnapshot {
	if response == nil {
		return ProviderAccountQuotaSnapshot{}
	}
	header := response.Header
	return ProviderAccountQuotaSnapshot{
		Provider:  provider,
		AccountID: accountID,
		Requests: AccountRateLimitSnapshot{
			Limit:     header.Get("anthropic-ratelimit-requests-limit"),
			Remaining: header.Get("anthropic-ratelimit-requests-remaining"),
			Reset:     header.Get("anthropic-ratelimit-requests-reset"),
		},
		InputTokens: AccountRateLimitSnapshot{
			Limit:     header.Get("anthropic-ratelimit-input-tokens-limit"),
			Remaining: header.Get("anthropic-ratelimit-input-tokens-remaining"),
			Reset:     header.Get("anthropic-ratelimit-input-tokens-reset"),
		},
		OutputTokens: AccountRateLimitSnapshot{
			Limit:     header.Get("anthropic-ratelimit-output-tokens-limit"),
			Remaining: header.Get("anthropic-ratelimit-output-tokens-remaining"),
			Reset:     header.Get("anthropic-ratelimit-output-tokens-reset"),
		},
		RetryAfter: header.Get("retry-after"),
		FetchedAt:  fetchedAt.UTC(),
	}
}

func shouldTryNextAnthropicAccount(ctx context.Context, err error) bool {
	if err == nil || (ctx != nil && ctx.Err() != nil) || isContextTermination(err) {
		return false
	}
	if apiErr := anthropicAPIError(err); apiErr != nil {
		status := apiErr.StatusCode
		errorType := string(apiErr.Type())
		return status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusRequestTimeout || status == http.StatusConflict || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError || errorType == "rate_limit_error" || errorType == "overloaded_error"
	}
	var netErr net.Error
	var urlErr *url.Error
	return errors.As(err, &netErr) || errors.As(err, &urlErr) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF)
}

func anthropicAPIError(err error) *anthropic.Error {
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		return apiErr
	}
	return nil
}

func anthropicErrorMetadata(err error) (int, string) {
	if apiErr := anthropicAPIError(err); apiErr != nil {
		return apiErr.StatusCode, string(apiErr.Type())
	}
	if isContextTermination(err) {
		return 0, telemetryErrorCode(err)
	}
	if err != nil {
		return 0, "network_error"
	}
	return 0, ""
}

func sanitizeAnthropicError(ctx context.Context, provider string, err error) error {
	if err == nil {
		return nil
	}
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if isContextTermination(err) {
		return err
	}
	if apiErr := anthropicAPIError(err); apiErr != nil {
		typeName := strings.TrimSpace(string(apiErr.Type()))
		if typeName == "" {
			typeName = http.StatusText(apiErr.StatusCode)
		}
		if typeName == "" {
			return fmt.Errorf("%s request failed: HTTP %d", provider, apiErr.StatusCode)
		}
		return fmt.Errorf("%s request failed: HTTP %d (%s)", provider, apiErr.StatusCode, typeName)
	}
	return providerUnavailableError(provider, "Anthropic request failed")
}
