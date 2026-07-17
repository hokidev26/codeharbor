package gateway

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"autoto/internal/db"
	"autoto/internal/providers"
)

const defaultMaxRequestBytes = int64(8 << 20)

type ProviderPolicy func(context.Context, string) bool

type Options struct {
	MaxGlobalConcurrency int
	MaxRequestBytes      int64
	ProviderAllowed      ProviderPolicy
	Now                  func() time.Time
}

type Service struct {
	store           *db.Store
	providers       *providers.Registry
	providerAllowed ProviderPolicy
	maxRequestBytes int64
	now             func() time.Time
	limits          *requestLimiter
}

func New(store *db.Store, registry *providers.Registry, options Options) (*Service, error) {
	if store == nil {
		return nil, errors.New("gateway store is required")
	}
	if registry == nil {
		return nil, errors.New("gateway provider registry is required")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.MaxRequestBytes <= 0 {
		options.MaxRequestBytes = defaultMaxRequestBytes
	}
	return &Service{
		store:           store,
		providers:       registry,
		providerAllowed: options.ProviderAllowed,
		maxRequestBytes: options.MaxRequestBytes,
		now:             options.Now,
		limits:          newRequestLimiter(options.MaxGlobalConcurrency, options.Now),
	}, nil
}

func (s *Service) Handler() http.Handler {
	return s
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if strings.TrimSpace(r.Header.Get("Origin")) != "" {
		writeAPIError(w, http.StatusForbidden, "browser_origin_forbidden", "Browser-origin requests are not allowed.", "invalid_request_error", "")
		return
	}

	switch r.URL.Path {
	case "/v1/models":
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.", "invalid_request_error", "")
			return
		}
		s.handleModels(w, r)
	case "/v1/chat/completions":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.", "invalid_request_error", "")
			return
		}
		s.handleChatCompletions(w, r)
	default:
		writeAPIError(w, http.StatusNotFound, "not_found", "Endpoint not found.", "invalid_request_error", "")
	}
}

func (s *Service) authenticateRequest(w http.ResponseWriter, r *http.Request) (db.GatewayKey, bool) {
	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="autoto-gateway"`)
		writeAPIError(w, http.StatusUnauthorized, "invalid_api_key", "Invalid API key.", "invalid_request_error", "")
		return db.GatewayKey{}, false
	}
	key, err := s.store.GetGatewayKeyByTokenHash(r.Context(), HashToken(token))
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			writeAPIError(w, http.StatusInternalServerError, "gateway_internal_error", "Gateway authentication failed.", "server_error", "")
			return db.GatewayKey{}, false
		}
		w.Header().Set("WWW-Authenticate", `Bearer realm="autoto-gateway"`)
		writeAPIError(w, http.StatusUnauthorized, "invalid_api_key", "Invalid API key.", "invalid_request_error", "")
		return db.GatewayKey{}, false
	}
	if !key.Enabled || key.RevokedAt != "" {
		w.Header().Set("WWW-Authenticate", `Bearer realm="autoto-gateway"`)
		writeAPIError(w, http.StatusUnauthorized, "invalid_api_key", "Invalid API key.", "invalid_request_error", "")
		return db.GatewayKey{}, false
	}
	if key.ExpiresAt != "" {
		expiresAt, parseErr := time.Parse(time.RFC3339Nano, key.ExpiresAt)
		if parseErr != nil {
			writeAPIError(w, http.StatusInternalServerError, "gateway_internal_error", "Gateway authentication failed.", "server_error", "")
			return db.GatewayKey{}, false
		}
		if !s.now().Before(expiresAt) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="autoto-gateway"`)
			writeAPIError(w, http.StatusUnauthorized, "expired_api_key", "API key has expired.", "invalid_request_error", "")
			return db.GatewayKey{}, false
		}
	}
	if err := s.limits.allowRequest(key); err != nil {
		w.Header().Set("Retry-After", "60")
		writeAPIError(w, http.StatusTooManyRequests, "rate_limit_exceeded", "Rate limit exceeded.", "rate_limit_error", "")
		return db.GatewayKey{}, false
	}
	touched, err := s.store.TouchGatewayKeyLastUsed(r.Context(), key.ID, s.now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		if errors.Is(err, db.ErrGatewayKeyRevoked) || errors.Is(err, sql.ErrNoRows) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="autoto-gateway"`)
			writeAPIError(w, http.StatusUnauthorized, "invalid_api_key", "Invalid API key.", "invalid_request_error", "")
			return db.GatewayKey{}, false
		}
		writeAPIError(w, http.StatusInternalServerError, "gateway_internal_error", "Gateway authentication failed.", "server_error", "")
		return db.GatewayKey{}, false
	}
	return touched, true
}

func bearerToken(value string) (string, bool) {
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) > 1024 {
		return "", false
	}
	return parts[1], parts[1] != ""
}

type resolvedModel struct {
	Alias    string
	Target   string
	Provider providers.Provider
	Model    string
}

func (s *Service) resolveModel(ctx context.Context, key db.GatewayKey, alias string) (resolvedModel, *apiProblem) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return resolvedModel{}, invalidParam("model", "A model is required.")
	}
	if !gatewayKeyAllowsModel(key, alias) {
		return resolvedModel{}, &apiProblem{Status: http.StatusNotFound, Code: "model_not_found", Type: "invalid_request_error", Message: "The requested model is not available."}
	}
	model, err := s.store.GetGatewayModel(ctx, alias)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedModel{}, &apiProblem{Status: http.StatusNotFound, Code: "model_not_found", Type: "invalid_request_error", Message: "The requested model is not available."}
		}
		return resolvedModel{}, internalProblem()
	}
	return s.resolveStoredModel(ctx, model)
}

func (s *Service) resolveStoredModel(ctx context.Context, model db.GatewayModel) (resolvedModel, *apiProblem) {
	if !model.Enabled {
		return resolvedModel{}, &apiProblem{Status: http.StatusNotFound, Code: "model_not_found", Type: "invalid_request_error", Message: "The requested model is not available."}
	}
	providerName, targetModel := providers.SplitModel(model.TargetModel)
	if providerName == "" || targetModel == "" {
		return resolvedModel{}, &apiProblem{Status: http.StatusServiceUnavailable, Code: "model_unavailable", Type: "server_error", Message: "The requested model is unavailable."}
	}
	if strings.EqualFold(providerName, "aggregate") {
		if providerName != "aggregate" {
			return resolvedModel{}, &apiProblem{Status: http.StatusServiceUnavailable, Code: "model_unavailable", Type: "server_error", Message: "The requested model is unavailable."}
		}
		aggregate, err := s.store.GetModelAggregate(ctx, targetModel)
		if err != nil {
			return resolvedModel{}, &apiProblem{Status: http.StatusServiceUnavailable, Code: "model_unavailable", Type: "server_error", Message: "The requested model is unavailable."}
		}
		definition := providers.AggregateDefinition{Name: aggregate.Name, Mode: aggregate.Mode, Members: append([]string(nil), aggregate.Members...)}
		provider, err := s.providers.ResolveAggregateSnapshot(definition)
		if err != nil {
			return resolvedModel{}, &apiProblem{Status: http.StatusServiceUnavailable, Code: "model_unavailable", Type: "server_error", Message: "The requested model is unavailable."}
		}
		for _, member := range definition.Members {
			memberProvider, memberModel := providers.SplitModel(member)
			if memberProvider == "" || memberModel == "" || strings.EqualFold(memberProvider, "aggregate") || !s.providerPermitted(ctx, memberProvider) {
				return resolvedModel{}, &apiProblem{Status: http.StatusForbidden, Code: "model_not_allowed", Type: "invalid_request_error", Message: "The requested model is not permitted for Gateway use."}
			}
		}
		return resolvedModel{Alias: model.Alias, Target: model.TargetModel, Provider: provider, Model: targetModel}, nil
	}
	if !s.providerPermitted(ctx, providerName) {
		return resolvedModel{}, &apiProblem{Status: http.StatusForbidden, Code: "model_not_allowed", Type: "invalid_request_error", Message: "The requested model is not permitted for Gateway use."}
	}
	provider, resolvedTarget, err := s.providers.Resolve(model.TargetModel)
	if err != nil || provider == nil || strings.TrimSpace(resolvedTarget) == "" {
		return resolvedModel{}, &apiProblem{Status: http.StatusServiceUnavailable, Code: "model_unavailable", Type: "server_error", Message: "The requested model is unavailable."}
	}
	return resolvedModel{Alias: model.Alias, Target: model.TargetModel, Provider: provider, Model: resolvedTarget}, nil
}

func (s *Service) providerPermitted(ctx context.Context, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || s.providerAllowed == nil || !s.providerAllowed(ctx, name) {
		return false
	}
	provider, ok := s.providers.Get(name)
	if !ok || provider == nil {
		return false
	}
	if _, blocked := provider.(*providers.CodexProvider); blocked {
		return false
	}
	return providers.ConfiguredForScenario(provider, true, providers.CallScenarioGateway)
}

func gatewayKeyAllowsModel(key db.GatewayKey, alias string) bool {
	if len(key.AllowedModels) == 0 {
		return true
	}
	for _, allowed := range key.AllowedModels {
		if allowed == alias {
			return true
		}
	}
	return false
}
