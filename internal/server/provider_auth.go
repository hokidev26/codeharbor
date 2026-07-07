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

	"codeharbor/internal/config"
)

type importAuthFileRequest struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

func (s *Server) listCLIProxyAPIAuthFiles(w http.ResponseWriter, r *http.Request) {
	body, err := s.cliProxyAPIManagementRequest(r.Context(), http.MethodGet, "/auth-files", nil, "")
	if err != nil {
		writeError(w, http.StatusBadGateway, friendlyCLIProxyAPIManagementError(err))
		return
	}
	writeRawJSON(w, body)
}

func (s *Server) importCLIProxyAPIAuthFile(w http.ResponseWriter, r *http.Request) {
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
		filename = fmt.Sprintf("codeharbor-codex-%d.json", time.Now().Unix())
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
	body, err := s.cliProxyAPIManagementRequest(r.Context(), http.MethodPost, "/auth-files", &payload, writer.FormDataContentType())
	if err != nil {
		writeError(w, http.StatusBadGateway, friendlyCLIProxyAPIManagementError(err))
		return
	}
	writeRawJSON(w, body)
}

func (s *Server) cliProxyAPIManagementRequest(ctx context.Context, method, path string, body io.Reader, contentType string) ([]byte, error) {
	base, err := s.cliProxyAPIManagementBaseURL()
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(base, "/") + "/" + strings.TrimLeft(path, "/")
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if key := cliProxyAPIManagementKey(); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("X-Management-Key", key)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("CLIProxyAPI management request failed: %s: %s", res.Status, strings.TrimSpace(string(data)))
	}
	return data, nil
}

func (s *Server) cliProxyAPIManagementBaseURL() (string, error) {
	provider, ok := s.cliProxyAPIProviderSummary()
	if !ok || strings.TrimSpace(provider.BaseURL) == "" {
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

func (s *Server) cliProxyAPIProviderSummary() (config.ProviderSummary, bool) {
	for _, provider := range s.configSnapshot().Providers.Summaries() {
		if provider.Name == "cliproxyapi" {
			return provider, true
		}
	}
	return config.ProviderSummary{}, false
}

func cliProxyAPIManagementKey() string {
	if key := strings.TrimSpace(os.Getenv("CLIPROXYAPI_MANAGEMENT_KEY")); key != "" {
		return key
	}
	return "codeharbor-local"
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
