package server

import (
	"net/http"
	"runtime/debug"
	"sort"
)

type licenseModule struct {
	Path     string `json:"path"`
	Version  string `json:"version,omitempty"`
	License  string `json:"license"`
	Relation string `json:"relation"`
}

var knownLicenses = map[string]string{
	"github.com/go-chi/chi/v5":               "MIT",
	"github.com/google/uuid":                 "BSD-3-Clause",
	"modernc.org/sqlite":                     "BSD-3-Clause",
	"nhooyr.io/websocket":                    "ISC",
	"github.com/openai/openai-go/v3":         "Apache-2.0",
	"github.com/anthropics/anthropic-sdk-go": "MIT",
	"github.com/creack/pty":                  "MIT",
	"golang.org/x/sys":                       "BSD-3-Clause",
	"golang.org/x/exp":                       "BSD-3-Clause",
	"github.com/dustin/go-humanize":          "MIT",
}

var directModules = map[string]struct{}{
	"github.com/go-chi/chi/v5":               {},
	"github.com/google/uuid":                 {},
	"modernc.org/sqlite":                     {},
	"nhooyr.io/websocket":                    {},
	"github.com/openai/openai-go/v3":         {},
	"github.com/anthropics/anthropic-sdk-go": {},
	"github.com/creack/pty":                  {},
}

func (s *Server) licenses(w http.ResponseWriter, r *http.Request) {
	info, ok := debug.ReadBuildInfo()
	modulesByPath := map[string]licenseModule{}
	if ok {
		for _, dep := range info.Deps {
			modulesByPath[dep.Path] = licenseModule{Path: dep.Path, Version: dep.Version, License: licenseFor(dep.Path), Relation: relationFor(dep.Path)}
		}
	}
	for path := range directModules {
		if _, ok := modulesByPath[path]; !ok {
			modulesByPath[path] = licenseModule{Path: path, License: licenseFor(path), Relation: "direct"}
		}
	}
	modules := make([]licenseModule, 0, len(modulesByPath))
	for _, module := range modulesByPath {
		modules = append(modules, module)
	}
	sort.Slice(modules, func(i, j int) bool { return modules[i].Path < modules[j].Path })
	writeJSON(w, http.StatusOK, map[string]any{
		"notice":  "Development aid only; verify before distribution. Not legal advice.",
		"modules": modules,
	})
}

func licenseFor(path string) string {
	if license, ok := knownLicenses[path]; ok {
		return license
	}
	return "unknown"
}

func relationFor(path string) string {
	if _, ok := directModules[path]; ok {
		return "direct"
	}
	return "indirect"
}
