package server

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed static/*
var staticFiles embed.FS

func (s *Server) mountUI(r interface {
	Get(pattern string, h http.HandlerFunc)
	Handle(pattern string, h http.Handler)
}) {
	r.Get("/", s.index)
	static, _ := fs.Sub(staticFiles, "static")
	fileServer := http.StripPrefix("/ui/", http.FileServer(http.FS(static)))
	r.Handle("/ui/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setNoStore(w)
		fileServer.ServeHTTP(w, r)
	}))
}

func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/ui/") {
		http.NotFound(w, r)
		return
	}
	data, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNoStore(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func setNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}
