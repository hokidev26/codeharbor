//go:build desktop

package desktop

import (
	"net/url"
	"strings"
)

const deepLinkScheme = "autoto"

// DeepLink is a parsed autoto:// URL for in-shell navigation only.
// It never opens host files or executes commands from the URL.
type DeepLink struct {
	Raw    string
	Host   string // open | agent | project | settings
	Path   string
	Query  url.Values
	Target string // relative UI path fragment, e.g. "/?agent=..."
}

// ParseDeepLink accepts autoto://… payloads. Unknown hosts are rejected.
func ParseDeepLink(raw string) (DeepLink, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DeepLink{}, false
	}
	// Allow bare scheme forms from some OS handoffs.
	if !strings.Contains(raw, "://") {
		if strings.HasPrefix(strings.ToLower(raw), deepLinkScheme+":") {
			raw = deepLinkScheme + "://" + strings.TrimPrefix(raw, deepLinkScheme+":")
			raw = strings.TrimPrefix(raw, "//")
			raw = deepLinkScheme + "://" + strings.TrimPrefix(raw, deepLinkScheme+"://")
		} else {
			return DeepLink{}, false
		}
	}
	u, err := url.Parse(raw)
	if err != nil {
		return DeepLink{}, false
	}
	if !strings.EqualFold(u.Scheme, deepLinkScheme) {
		return DeepLink{}, false
	}
	host := strings.ToLower(strings.TrimSpace(u.Host))
	if host == "" {
		// autoto:///settings or autoto:/settings
		host = strings.ToLower(strings.Trim(strings.TrimPrefix(u.Path, "/"), "/"))
		parts := strings.SplitN(host, "/", 2)
		host = parts[0]
		if len(parts) == 2 {
			u.Path = "/" + parts[1]
		} else {
			u.Path = ""
		}
	}
	switch host {
	case "open", "agent", "project", "settings", "conversation":
	default:
		return DeepLink{}, false
	}
	link := DeepLink{
		Raw:   raw,
		Host:  host,
		Path:  u.Path,
		Query: u.Query(),
	}
	link.Target = deepLinkTarget(link)
	return link, true
}

func deepLinkTarget(link DeepLink) string {
	q := url.Values{}
	for key, values := range link.Query {
		for _, value := range values {
			if value != "" {
				q.Add(key, value)
			}
		}
	}
	switch link.Host {
	case "agent":
		id := firstNonEmpty(q.Get("id"), strings.Trim(link.Path, "/"))
		if id != "" {
			return "/#agent=" + url.QueryEscape(id)
		}
		return "/"
	case "project":
		id := firstNonEmpty(q.Get("id"), strings.Trim(link.Path, "/"))
		if id != "" {
			return "/#project=" + url.QueryEscape(id)
		}
		return "/"
	case "conversation":
		id := firstNonEmpty(q.Get("id"), strings.Trim(link.Path, "/"))
		if id != "" {
			return "/#conversation=" + url.QueryEscape(id)
		}
		return "/"
	case "settings":
		panel := firstNonEmpty(q.Get("panel"), strings.Trim(link.Path, "/"))
		if panel != "" {
			return "/#settings=" + url.QueryEscape(panel)
		}
		return "/#settings"
	case "open":
		// Optional relative path hint only — never file:// or absolute host paths.
		path := firstNonEmpty(q.Get("view"), strings.TrimPrefix(link.Path, "/"))
		if path == "" {
			return "/"
		}
		if strings.Contains(path, "://") || strings.HasPrefix(path, "//") {
			return "/"
		}
		return "/#" + url.PathEscape(path)
	default:
		return "/"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// FindDeepLinkInArgs returns the first autoto:// argument, if any.
func FindDeepLinkInArgs(args []string) (string, bool) {
	for _, arg := range args {
		if _, ok := ParseDeepLink(arg); ok {
			return arg, true
		}
	}
	return "", false
}
