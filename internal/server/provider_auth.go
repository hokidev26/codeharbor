package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
)

type importAuthFileRequest struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

// listProviderAuthFiles serves management auth files for the provider named in
// the route. Only profiles that declare auth-file management are supported.
func (s *Server) listProviderAuthFiles(w http.ResponseWriter, r *http.Request) {
	s.listProviderAuthFilesForName(w, r, strings.TrimSpace(chi.URLParam(r, "name")))
}

// listCLIProxyAPIAuthFiles preserves the legacy route while delegating to the
// profile-aware handler.
func (s *Server) listCLIProxyAPIAuthFiles(w http.ResponseWriter, r *http.Request) {
	s.listProviderAuthFilesForName(w, r, config.ProviderProfileCLIProxyAPI)
}

func (s *Server) listProviderAuthFilesForName(w http.ResponseWriter, r *http.Request, name string) {
	provider, err := s.authFileProvider(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	body, err := s.providerManagementRequest(r.Context(), provider, http.MethodGet, "/auth-files", nil, "")
	if err != nil {
		writeError(w, http.StatusBadGateway, friendlyProviderManagementError(provider, err))
		return
	}
	writeRawJSON(w, body)
}

// importProviderAuthFile accepts an auth-file upload for the route provider.
func (s *Server) importProviderAuthFile(w http.ResponseWriter, r *http.Request) {
	s.importProviderAuthFileForName(w, r, strings.TrimSpace(chi.URLParam(r, "name")))
}

// importCLIProxyAPIAuthFile preserves the legacy route while delegating to the
// profile-aware handler.
func (s *Server) importCLIProxyAPIAuthFile(w http.ResponseWriter, r *http.Request) {
	s.importProviderAuthFileForName(w, r, config.ProviderProfileCLIProxyAPI)
}

func (s *Server) importProviderAuthFileForName(w http.ResponseWriter, r *http.Request, name string) {
	provider, err := s.authFileProvider(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	var req importAuthFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		writeError(w, http.StatusBadRequest, "请粘贴 JSON 或 token 内容")
		return
	}
	filename := strings.TrimSpace(req.Filename)
	if filename == "" {
		filename = fmt.Sprintf("autoto-codex-%d.json", time.Now().Unix())
	}
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := io.Copy(part, strings.NewReader(content)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := writer.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	body, err := s.providerManagementRequest(r.Context(), provider, http.MethodPost, "/auth-files", &payload, writer.FormDataContentType())
	if err != nil {
		writeError(w, http.StatusBadGateway, friendlyProviderManagementError(provider, err))
		return
	}
	writeRawJSON(w, body)
}

func (s *Server) cliProxyAPIManagementRequest(ctx context.Context, method, path string, body io.Reader, contentType string) ([]byte, error) {
	provider, ok := s.cliProxyAPIProviderSummary()
	if !ok {
		return nil, fmt.Errorf("CLIProxyAPI provider is not configured")
	}
	return s.providerManagementRequest(ctx, provider, method, path, body, contentType)
}

func (s *Server) providerManagementRequest(ctx context.Context, provider config.ProviderSummary, method, path string, body io.Reader, contentType string) ([]byte, error) {
	base, err := providerManagementBaseURL(provider)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(base, "/") + "/" + strings.TrimLeft(path, "/")
	var payload []byte
	if body != nil {
		payload, err = io.ReadAll(body)
		if err != nil {
			return nil, err
		}
	}
	key, explicitlyConfigured := cliProxyAPIManagementKeyWithSource()
	data, status, err := cliProxyAPIManagementRequestWithKey(ctx, method, endpoint, payload, contentType, key)
	if !explicitlyConfigured && status == http.StatusUnauthorized {
		legacyData, _, legacyErr := cliProxyAPIManagementRequestWithKey(ctx, method, endpoint, payload, contentType, legacyCLIProxyAPIManagementKey)
		return legacyData, legacyErr
	}
	return data, err
}

func cliProxyAPIManagementRequestWithKey(ctx context.Context, method, endpoint string, payload []byte, contentType, key string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("X-Management-Key", key)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, res.StatusCode, err
	}
	if res.StatusCode >= 300 {
		return nil, res.StatusCode, fmt.Errorf("CLIProxyAPI management request failed: %s", res.Status)
	}
	return data, res.StatusCode, nil
}

func (s *Server) cliProxyAPIManagementBaseURL() (string, error) {
	provider, ok := s.cliProxyAPIProviderSummary()
	if !ok {
		return "http://127.0.0.1:8317/v0/management", nil
	}
	return providerManagementBaseURL(provider)
}

func providerManagementBaseURL(provider config.ProviderSummary) (string, error) {
	if provider.Profile != config.ProviderProfileCLIProxyAPI {
		return "", fmt.Errorf("provider %s does not support management auth files", provider.Name)
	}
	if strings.TrimSpace(provider.BaseURL) == "" {
		return "http://127.0.0.1:8317/v0/management", nil
	}
	parsed, err := url.Parse(provider.BaseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("CLIProxyAPI Base URL 无效")
	}
	parsed.Path = "/v0/management"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func (s *Server) authFileProvider(name string) (config.ProviderSummary, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return config.ProviderSummary{}, fmt.Errorf("provider name is required")
	}
	for _, provider := range s.configSnapshot().Providers.Summaries() {
		if provider.Name != name {
			continue
		}
		if provider.Profile != config.ProviderProfileCLIProxyAPI {
			return config.ProviderSummary{}, fmt.Errorf("provider %s does not support auth files", name)
		}
		return provider, nil
	}
	return config.ProviderSummary{}, fmt.Errorf("provider %s is not configured", name)
}

func (s *Server) cliProxyAPIProviderSummary() (config.ProviderSummary, bool) {
	for _, provider := range s.configSnapshot().Providers.Summaries() {
		if provider.Profile == config.ProviderProfileCLIProxyAPI {
			return provider, true
		}
	}
	return config.ProviderSummary{}, false
}

const (
	defaultCLIProxyAPIManagementKey = "autoto-local"
	legacyCLIProxyAPIManagementKey  = "codeharbor-local"
)

func cliProxyAPIManagementKey() string {
	key, _ := cliProxyAPIManagementKeyWithSource()
	return key
}

func cliProxyAPIManagementKeyWithSource() (string, bool) {
	if key := strings.TrimSpace(os.Getenv("CLIPROXYAPI_MANAGEMENT_KEY")); key != "" {
		return key, true
	}
	return defaultCLIProxyAPIManagementKey, false
}

func friendlyProviderManagementError(provider config.ProviderSummary, err error) string {
	if provider.Profile != config.ProviderProfileCLIProxyAPI {
		return "Provider 管理请求失败：" + err.Error()
	}
	return friendlyCLIProxyAPIManagementError(err)
}

func friendlyCLIProxyAPIManagementError(err error) string {
	message := err.Error()
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "connection refused"), strings.Contains(lower, "connect:"):
		return "无法连接 CLIProxyAPI 管理接口。请确认 CLIProxyAPI 已启动并监听 127.0.0.1:8317。"
	case strings.Contains(lower, "401") || strings.Contains(lower, "unauthorized"):
		return "CLIProxyAPI 管理接口认证失败。请确认 CLIPROXYAPI_MANAGEMENT_KEY 或本地管理密码。"
	case strings.Contains(lower, "404"):
		return "CLIProxyAPI 管理接口未启用。请确认 config.yaml 中 remote-management.secret-key 已设置。"
	default:
		return "CLIProxyAPI 管理请求失败：" + message
	}
}

func writeRawJSON(w http.ResponseWriter, body []byte) {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"raw": string(body)})
		return
	}
	writeJSON(w, http.StatusOK, value)
}
