package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrNilService        = errors.New("runtime: nil service")
	ErrSupervisorStarted = errors.New("runtime: supervisor already started")
)

// Service defines the lifecycle managed by Supervisor.
type Service interface {
	Start(context.Context) error
	Close(context.Context) error
}

type supervisorState uint8

const (
	supervisorNew supervisorState = iota
	supervisorStarting
	supervisorRunning
	supervisorFailed
	supervisorClosed
)

// Supervisor starts registered services in order and closes them in reverse order.
type Supervisor struct {
	mu sync.Mutex

	services []Service
	started  int
	state    supervisorState
	closeErr error
}

func NewSupervisor() *Supervisor {
	return &Supervisor{}
}

// Register adds a service to the end of the lifecycle order.
func (s *Supervisor) Register(service Service) error {
	if service == nil {
		return ErrNilService
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != supervisorNew {
		return ErrSupervisorStarted
	}
	s.services = append(s.services, service)
	return nil
}

// Start starts every registered service in registration order. If a service
// fails to start, already-started services are closed in reverse order.
func (s *Supervisor) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.state != supervisorNew {
		return ErrSupervisorStarted
	}
	s.state = supervisorStarting

	for index, service := range s.services {
		if err := service.Start(ctx); err != nil {
			errs := []error{fmt.Errorf("start service %d: %w", index, err)}
			rollbackCtx := context.WithoutCancel(ctx)
			for rollbackIndex := s.started - 1; rollbackIndex >= 0; rollbackIndex-- {
				if closeErr := s.services[rollbackIndex].Close(rollbackCtx); closeErr != nil {
					errs = append(errs, fmt.Errorf("rollback service %d: %w", rollbackIndex, closeErr))
				}
			}
			s.started = 0
			s.state = supervisorFailed
			return errors.Join(errs...)
		}
		s.started++
	}

	s.state = supervisorRunning
	return nil
}

// Close closes started services in reverse registration order. It is safe to
// call concurrently or repeatedly; all callers receive the same aggregated
// result from the first close operation.
func (s *Supervisor) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.state == supervisorClosed {
		return s.closeErr
	}
	if s.state == supervisorNew || s.state == supervisorFailed {
		s.state = supervisorClosed
		return nil
	}

	var errs []error
	for index := s.started - 1; index >= 0; index-- {
		if err := s.services[index].Close(ctx); err != nil {
			errs = append(errs, fmt.Errorf("close service %d: %w", index, err))
		}
	}
	s.started = 0
	s.closeErr = errors.Join(errs...)
	s.state = supervisorClosed
	return s.closeErr
}
