package runtime

import (
	"context"
	"errors"
	"net/http"
)

// HTTPService adapts an http.Server to the Service lifecycle.
type HTTPService struct {
	server       *http.Server
	onServeError func(error)
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
	go func() {
		if err := s.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) && s.onServeError != nil {
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
