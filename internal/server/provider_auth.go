package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"codeharbor/internal/config"
)

const maxProviderJobOutput = 80_000

type providerLoginJob struct {
	ID         string   `json:"id"`
	Method     string   `json:"method"`
	Status     string   `json:"status"`
	Command    []string `json:"command,omitempty"`
	Output     string   `json:"output"`
	Error      string   `json:"error,omitempty"`
	StartedAt  string   `json:"startedAt"`
	FinishedAt string   `json:"finishedAt,omitempty"`
}

type providerLoginRequest struct {
	Method string `json:"method"`
}

type importAuthFileRequest struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

func (s *Server) startCLIProxyAPICodexLogin(w http.ResponseWriter, r *http.Request) {
	var req providerLoginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	method := strings.ToLower(strings.TrimSpace(req.Method))
	if method == "" {
		method = "browser"
	}
	flag := "-codex-login"
	switch method {
	case "browser", "oauth":
		method = "browser"
	case "device", "device-code":
		method = "device"
		flag = "-codex-device-login"
	default:
		writeError(w, http.StatusBadRequest, "method must be browser or device")
		return
	}

	bin, err := cliProxyAPIBinaryPath()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	args := cliProxyAPICommandArgs(flag)
	job := &providerLoginJob{
		ID:        uuid.NewString(),
		Method:    method,
		Status:    "running",
		Command:   append([]string{bin}, args...),
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	s.storeProviderJob(job)
	go s.runProviderLoginJob(job.ID, bin, args)
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) getProviderLoginJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.providerJob(chi.URLParam(r, "id"))
	if !ok {
		writeError(w, http.StatusNotFound, "login job not found")
		return
	}
	writeJSON(w, http.StatusOK, job)
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

func (s *Server) runProviderLoginJob(id, bin string, args []string) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = filepath.Dir(bin)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.finishProviderJob(id, err)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.finishProviderJob(id, err)
		return
	}
	if err := cmd.Start(); err != nil {
		s.finishProviderJob(id, err)
		return
	}
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(providerJobWriter{server: s, id: id}, stdout)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(providerJobWriter{server: s, id: id}, stderr)
		done <- struct{}{}
	}()
	err = cmd.Wait()
	<-done
	<-done
	s.finishProviderJob(id, err)
}

type providerJobWriter struct {
	server *Server
	id     string
}

func (w providerJobWriter) Write(data []byte) (int, error) {
	w.server.appendProviderJobOutput(w.id, string(data))
	return len(data), nil
}

func (s *Server) storeProviderJob(job *providerLoginJob) {
	s.providerJobsMu.Lock()
	defer s.providerJobsMu.Unlock()
	if s.providerJobs == nil {
		s.providerJobs = make(map[string]*providerLoginJob)
	}
	s.providerJobs[job.ID] = job
}

func (s *Server) providerJob(id string) (providerLoginJob, bool) {
	s.providerJobsMu.Lock()
	defer s.providerJobsMu.Unlock()
	job, ok := s.providerJobs[id]
	if !ok {
		return providerLoginJob{}, false
	}
	return *job, true
}

func (s *Server) appendProviderJobOutput(id, output string) {
	s.providerJobsMu.Lock()
	defer s.providerJobsMu.Unlock()
	job, ok := s.providerJobs[id]
	if !ok {
		return
	}
	job.Output += output
	if len(job.Output) > maxProviderJobOutput {
		job.Output = job.Output[len(job.Output)-maxProviderJobOutput:]
	}
}

func (s *Server) finishProviderJob(id string, err error) {
	s.providerJobsMu.Lock()
	defer s.providerJobsMu.Unlock()
	job, ok := s.providerJobs[id]
	if !ok {
		return
	}
	job.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		job.Output += "\n[CodeHarbor] 登录流程失败：" + err.Error() + "\n"
		return
	}
	job.Status = "succeeded"
	job.Output += "\n[CodeHarbor] 登录流程已结束。\n"
}

func cliProxyAPIBinaryPath() (string, error) {
	candidates := []string{
		os.Getenv("CLIPROXYAPI_BIN"),
		defaultCLIProxyAPIPath("cli-proxy-api"),
	}
	if path, err := exec.LookPath("cli-proxy-api"); err == nil {
		candidates = append(candidates, path)
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("找不到 CLIProxyAPI 可执行文件。请设置 CLIPROXYAPI_BIN，或安装到 ~/Desktop/CLIProxyAPI/cli-proxy-api")
}

func cliProxyAPIConfigPath() string {
	for _, candidate := range []string{os.Getenv("CLIPROXYAPI_CONFIG"), defaultCLIProxyAPIPath("config.yaml")} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func defaultCLIProxyAPIPath(name string) string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, "Desktop", "CLIProxyAPI", name)
}

func cliProxyAPICommandArgs(loginFlag string) []string {
	args := make([]string, 0, 3)
	if configPath := cliProxyAPIConfigPath(); configPath != "" {
		args = append(args, "-config", configPath)
	}
	return append(args, loginFlag)
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
		return "", errors.New("CLIProxyAPI Base URL 无效")
	}
	parsed.Path = "/v0/management"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func (s *Server) cliProxyAPIProviderSummary() (config.ProviderSummary, bool) {
	for _, provider := range s.cfg.Providers.Summaries() {
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
