package server

import (
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
)

// newTestRequest makes the default in-package request explicitly local. Tests
// exercising remote access must override Host/RemoteAddr and, for successful
// remote traffic, set TLS or trusted proxy HTTPS headers themselves.
func newTestRequest(method, target string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, target, body)
	req.Host = "localhost:7788"
	req.RemoteAddr = "127.0.0.1:1234"
	return req
}

func markRemoteHTTPS(req *http.Request) *http.Request {
	req.RemoteAddr = "203.0.113.10:1234"
	req.TLS = &tls.ConnectionState{}
	return req
}

func markRemotePlainHTTP(req *http.Request) *http.Request {
	req.RemoteAddr = "203.0.113.10:1234"
	req.TLS = nil
	return req
}

func markLoopbackProxyHTTPS(req *http.Request) *http.Request {
	req.RemoteAddr = "127.0.0.1:1234"
	req.TLS = nil
	req.Header.Set("X-Forwarded-Proto", "https")
	return req
}
