package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const webFetchMaxBytes = 1 << 20
const webFetchDefaultLimit = 20000
const webFetchMaxLimit = 100000

type WebFetchTool struct{}

type webFetchInput struct {
	URL     string `json:"url"`
	Limit   int    `json:"limit,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

func (WebFetchTool) Name() string { return "WebFetch" }
func (WebFetchTool) Description() string {
	return "Fetch a public HTTP(S) URL and return simplified text for documentation lookup."
}
func (WebFetchTool) Schema() any               { return webFetchInput{} }
func (WebFetchTool) Risk(json.RawMessage) Risk { return RiskRead }

func (WebFetchTool) Execute(ctx context.Context, call Call, env Env) (Result, error) {
	var input webFetchInput
	if err := json.Unmarshal(call.Input, &input); err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	target, err := validatePublicFetchURL(ctx, input.URL)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	timeout := time.Duration(input.Timeout) * time.Millisecond
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	fetchCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, target.String(), nil)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	req.Header.Set("User-Agent", "CodeHarbor-WebFetch/0.1")
	req.Header.Set("Accept", "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.1")
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{Output: fmt.Sprintf("fetch failed with status %s", resp.Status), IsError: true, Meta: map[string]any{"status": resp.StatusCode, "url": target.String()}}, nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, webFetchMaxBytes+1))
	if err != nil {
		return Result{Output: err.Error(), IsError: true}, nil
	}
	truncatedBody := len(data) > webFetchMaxBytes
	if truncatedBody {
		data = data[:webFetchMaxBytes]
	}
	text := simplifyFetchedContent(resp.Header.Get("Content-Type"), string(data))
	limit := input.Limit
	if limit <= 0 {
		limit = webFetchDefaultLimit
	}
	if limit > webFetchMaxLimit {
		limit = webFetchMaxLimit
	}
	out, truncatedText := truncate(text, limit)
	return Result{Output: out, Meta: map[string]any{"url": target.String(), "status": resp.StatusCode, "contentType": resp.Header.Get("Content-Type"), "truncated": truncatedBody || truncatedText}}, nil
}

func validatePublicFetchURL(ctx context.Context, raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("url is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("only http and https urls are supported")
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("url host is required")
	}
	if isLocalHostname(host) {
		return nil, fmt.Errorf("local/private hosts are not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateOrLocalIP(ip) {
			return nil, fmt.Errorf("local/private hosts are not allowed")
		}
		return parsed, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(lookupCtx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve host: %w", err)
	}
	for _, addr := range addrs {
		if isPrivateOrLocalIP(addr.IP) {
			return nil, fmt.Errorf("local/private hosts are not allowed")
		}
	}
	return parsed, nil
}

func isLocalHostname(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	return host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "0.0.0.0"
}

func isPrivateOrLocalIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func simplifyFetchedContent(contentType, body string) string {
	lower := strings.ToLower(contentType)
	if strings.Contains(lower, "html") || strings.Contains(strings.ToLower(body[:min(len(body), 512)]), "<html") {
		return htmlToText(body)
	}
	return strings.TrimSpace(body)
}

var (
	scriptRE     = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	styleRE      = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	noscriptRE   = regexp.MustCompile(`(?is)<noscript[^>]*>.*?</noscript>`)
	tagBreakRE   = regexp.MustCompile(`(?i)</?(p|br|div|section|article|header|footer|main|li|ul|ol|h[1-6]|tr|table|pre|blockquote)[^>]*>`)
	tagRE        = regexp.MustCompile(`(?s)<[^>]+>`)
	blankLinesRE = regexp.MustCompile(`\n{3,}`)
	spacesRE     = regexp.MustCompile(`[ \t\f\r]+`)
)

func htmlToText(body string) string {
	body = scriptRE.ReplaceAllString(body, "")
	body = styleRE.ReplaceAllString(body, "")
	body = noscriptRE.ReplaceAllString(body, "")
	body = tagBreakRE.ReplaceAllString(body, "\n")
	body = tagRE.ReplaceAllString(body, "")
	body = html.UnescapeString(body)
	lines := strings.Split(body, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(spacesRE.ReplaceAllString(line, " "))
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.TrimSpace(blankLinesRE.ReplaceAllString(strings.Join(out, "\n"), "\n\n"))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
