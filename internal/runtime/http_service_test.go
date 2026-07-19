package runtime

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestHTTPServiceStartReportsBindFailureSynchronously(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()

	service := NewHTTPService(&http.Server{Addr: occupied.Addr().String()}, nil)
	if err := service.Start(context.Background()); err == nil {
		t.Fatal("expected occupied address to fail during Start")
	}
}

func TestHTTPServiceStartsWithPreparedListenerWithoutRebinding(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	service := NewHTTPServiceWithListener(&http.Server{
		Addr: listener.Addr().String(),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	}, listener, nil)
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("prepared listener should start without a second bind: %v", err)
	}

	client := &http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", response.StatusCode)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := service.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPServiceServesAndShutsDownBoundListener(t *testing.T) {
	service := NewHTTPService(&http.Server{
		Addr: "127.0.0.1:0",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	}, nil)
	if err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}

	service.mu.Lock()
	addr := service.listener.Addr().String()
	service.mu.Unlock()
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + addr)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected status %d", response.StatusCode)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := service.Close(ctx); err != nil {
		t.Fatal(err)
	}
}
