package app

import (
	"context"
	"reflect"
	"sync"
	"testing"

	"autoto/internal/runtime"
)

type orderedService struct {
	name   string
	mu     *sync.Mutex
	closed *[]string
}

func (s orderedService) Start(context.Context) error { return nil }
func (s orderedService) Close(context.Context) error {
	s.mu.Lock()
	*s.closed = append(*s.closed, s.name)
	s.mu.Unlock()
	return nil
}

func TestRuntimeRegistrationClosesHTTPBeforeWorkers(t *testing.T) {
	var mu sync.Mutex
	closed := []string{}
	service := func(name string) orderedService { return orderedService{name: name, mu: &mu, closed: &closed} }
	supervisor := runtime.NewSupervisor()
	if err := registerRuntimeServices(supervisor, service("preview"), service("channels"), service("automation"), service("http")); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"http", "automation", "channels", "preview"}
	if !reflect.DeepEqual(closed, want) {
		t.Fatalf("unexpected close order: got %v want %v", closed, want)
	}
}
