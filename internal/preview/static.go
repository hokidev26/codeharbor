package preview

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type staticHandler struct {
	workspace string
	serveDir  string
}

func newStaticHandler(workspace, serveDir string) http.Handler {
	return staticHandler{workspace: filepath.Clean(workspace), serveDir: filepath.Clean(serveDir)}
}

func (h staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.ContainsRune(r.URL.Path, '\x00') || strings.Contains(r.URL.Path, "\\") || hasTraversalSegment(r.URL.Path) {
		http.NotFound(w, r)
		return
	}

	cleanURLPath := path.Clean("/" + r.URL.Path)
	if sensitivePath(cleanURLPath) {
		http.NotFound(w, r)
		return
	}
	relURLPath := strings.TrimPrefix(cleanURLPath, "/")
	target := filepath.Join(h.serveDir, filepath.FromSlash(relURLPath))
	if !withinPath(h.serveDir, target) {
		http.NotFound(w, r)
		return
	}

	realTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if !withinPath(h.serveDir, realTarget) || !withinPath(h.workspace, realTarget) || sensitiveRealPath(h.workspace, realTarget) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(realTarget)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		realTarget = filepath.Join(realTarget, "index.html")
		realTarget, err = filepath.EvalSymlinks(realTarget)
		if err != nil || !withinPath(h.serveDir, realTarget) || !withinPath(h.workspace, realTarget) || sensitiveRealPath(h.workspace, realTarget) {
			http.NotFound(w, r)
			return
		}
		info, err = os.Stat(realTarget)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}

	file, err := os.Open(realTarget)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filepath.Base(realTarget), info.ModTime(), file)
}

func hasTraversalSegment(urlPath string) bool {
	for _, segment := range strings.Split(urlPath, "/") {
		if segment == ".." {
			return true
		}
	}
	return false
}

func sensitiveRealPath(workspace, target string) bool {
	rel, err := filepath.Rel(workspace, target)
	if err != nil {
		return true
	}
	return sensitivePath(filepath.ToSlash(rel))
}

func sensitivePath(value string) bool {
	parts := strings.FieldsFunc(filepath.ToSlash(value), func(r rune) bool { return r == '/' })
	for _, part := range parts {
		name := strings.ToLower(part)
		if name == "" || name == "." {
			continue
		}
		if strings.HasPrefix(name, ".") || strings.HasPrefix(name, ".env") {
			return true
		}
		switch name {
		case "id_rsa", "id_ed25519", "credentials.json", "credentials", "secrets.json", "secret.json":
			return true
		}
		if strings.HasSuffix(name, ".pem") || strings.HasSuffix(name, ".key") || strings.HasSuffix(name, ".p12") || strings.HasSuffix(name, ".pfx") {
			return true
		}
	}
	return false
}
