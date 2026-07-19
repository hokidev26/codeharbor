package runtime

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
)

// HTTPService adapts an http.Server to the Service lifecycle.
type HTTPService struct {
	server       *http.Server
	onServeError func(error)

	mu       sync.Mutex
	listener net.Listener
	started  bool
}

func NewHTTPService(server *http.Server, onServeError func(error)) *HTTPService {
	return NewHTTPServiceWithListener(server, nil, onServeError)
}

// NewHTTPServiceWithListener adapts an HTTP server around a listener that was
// acquired before mutable startup work. Supplying a pre-bound listener lets an
// application reject duplicate processes before they can recover or alter
// durable run state.
func NewHTTPServiceWithListener(server *http.Server, listener net.Listener, onServeError func(error)) *HTTPService {
	return &HTTPService{
		server:       server,
		onServeError: onServeError,
		listener:     listener,
	}
}

func (s *HTTPService) Start(context.Context) error {
	if s.server == nil {
		return errors.New("runtime: nil HTTP server")
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return errors.New("runtime: HTTP service already started")
	}
	s.started = true
	listener := s.listener
	s.mu.Unlock()

	if listener == nil {
		var err error
		listener, err = net.Listen("tcp", s.server.Addr)
		if err != nil {
			s.mu.Lock()
			s.started = false
			s.mu.Unlock()
			return err
		}
		s.mu.Lock()
		s.listener = listener
		s.mu.Unlock()
	}

	go func() {
		if err := s.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && s.onServeError != nil {
			s.onServeError(err)
		}
	}()
	return nil
}

func (s *HTTPService) Close(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}
