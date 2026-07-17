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
}

func NewHTTPService(server *http.Server, onServeError func(error)) *HTTPService {
	return &HTTPService{
		server:       server,
		onServeError: onServeError,
	}
}

func (s *HTTPService) Start(context.Context) error {
	if s.server == nil {
		return errors.New("runtime: nil HTTP server")
	}
	listener, err := net.Listen("tcp", s.server.Addr)
	if err != nil {
		return err
	}

	s.mu.Lock()
	if s.listener != nil {
		s.mu.Unlock()
		_ = listener.Close()
		return errors.New("runtime: HTTP service already started")
	}
	s.listener = listener
	s.mu.Unlock()

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
