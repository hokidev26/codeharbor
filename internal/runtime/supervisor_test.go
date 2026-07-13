package runtime

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
)

type eventRecorder struct {
	mu     sync.Mutex
	events []string
}

func (r *eventRecorder) add(event string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
}

func (r *eventRecorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.events...)
}

type testService struct {
	name         string
	recorder     *eventRecorder
	startErr     error
	closeErr     error
	closeStarted chan struct{}
	closeRelease chan struct{}
	closeCalls   atomic.Int32
}

func (s *testService) Start(context.Context) error {
	s.recorder.add("start:" + s.name)
	return s.startErr
}

func (s *testService) Close(context.Context) error {
	s.closeCalls.Add(1)
	s.recorder.add("close:" + s.name)
	if s.closeStarted != nil {
		close(s.closeStarted)
	}
	if s.closeRelease != nil {
		<-s.closeRelease
	}
	return s.closeErr
}

func registerServices(t *testing.T, supervisor *Supervisor, services ...Service) {
	t.Helper()
	for _, service := range services {
		if err := supervisor.Register(service); err != nil {
			t.Fatalf("Register() error = %v", err)
		}
	}
}

func TestSupervisorStartsServicesInRegistrationOrder(t *testing.T) {
	recorder := &eventRecorder{}
	supervisor := NewSupervisor()
	registerServices(t, supervisor,
		&testService{name: "one", recorder: recorder},
		&testService{name: "two", recorder: recorder},
		&testService{name: "three", recorder: recorder},
	)

	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	want := []string{"start:one", "start:two", "start:three"}
	if got := recorder.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
}

func TestSupervisorRollsBackStartedServicesOnStartFailure(t *testing.T) {
	errStart := errors.New("start failed")
	recorder := &eventRecorder{}
	supervisor := NewSupervisor()
	registerServices(t, supervisor,
		&testService{name: "one", recorder: recorder},
		&testService{name: "two", recorder: recorder},
		&testService{name: "three", recorder: recorder, startErr: errStart},
		&testService{name: "four", recorder: recorder},
	)

	err := supervisor.Start(context.Background())
	if !errors.Is(err, errStart) {
		t.Fatalf("Start() error = %v, want error matching %v", err, errStart)
	}

	want := []string{"start:one", "start:two", "start:three", "close:two", "close:one"}
	if got := recorder.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
	if err := supervisor.Close(context.Background()); err != nil {
		t.Fatalf("Close() after rollback error = %v", err)
	}
	if got := recorder.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Close() repeated lifecycle work: events = %v, want %v", got, want)
	}
}

func TestSupervisorClosesServicesInReverseOrderAndAggregatesErrors(t *testing.T) {
	errOne := errors.New("close one")
	errThree := errors.New("close three")
	recorder := &eventRecorder{}
	supervisor := NewSupervisor()
	registerServices(t, supervisor,
		&testService{name: "one", recorder: recorder, closeErr: errOne},
		&testService{name: "two", recorder: recorder},
		&testService{name: "three", recorder: recorder, closeErr: errThree},
	)
	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	err := supervisor.Close(context.Background())
	if !errors.Is(err, errOne) || !errors.Is(err, errThree) {
		t.Fatalf("Close() error = %v, want errors matching %v and %v", err, errOne, errThree)
	}
	want := []string{"start:one", "start:two", "start:three", "close:three", "close:two", "close:one"}
	if got := recorder.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
}

func TestSupervisorCloseIsConcurrentAndIdempotent(t *testing.T) {
	errClose := errors.New("close failed")
	recorder := &eventRecorder{}
	service := &testService{
		name:         "only",
		recorder:     recorder,
		closeErr:     errClose,
		closeStarted: make(chan struct{}),
		closeRelease: make(chan struct{}),
	}
	supervisor := NewSupervisor()
	registerServices(t, supervisor, service)
	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	const callers = 8
	errs := make(chan error, callers)
	var callersDone sync.WaitGroup
	callersDone.Add(callers)
	for range callers {
		go func() {
			defer callersDone.Done()
			errs <- supervisor.Close(context.Background())
		}()
	}

	<-service.closeStarted
	close(service.closeRelease)
	callersDone.Wait()
	close(errs)

	for err := range errs {
		if !errors.Is(err, errClose) {
			t.Errorf("Close() error = %v, want error matching %v", err, errClose)
		}
	}
	if got := service.closeCalls.Load(); got != 1 {
		t.Fatalf("Close() calls = %d, want 1", got)
	}
	if err := supervisor.Close(context.Background()); !errors.Is(err, errClose) {
		t.Fatalf("repeated Close() error = %v, want error matching %v", err, errClose)
	}
	if got := service.closeCalls.Load(); got != 1 {
		t.Fatalf("Close() calls after repeat = %d, want 1", got)
	}
}
