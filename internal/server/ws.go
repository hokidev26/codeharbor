package server

import (
	"context"
	"net/http"
	"time"

	"nhooyr.io/websocket"
)

func (s *Server) narratorWS(w http.ResponseWriter, r *http.Request) {
	narratorID := r.URL.Query().Get("id")
	if narratorID == "" {
		writeError(w, http.StatusBadRequest, "id query parameter is required")
		return
	}
	if !s.validateWebSocketRequest(w, r) {
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sub := s.hub.Subscribe(ctx, narratorID)
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"connected"}`))

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-sub:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
			if err := conn.Write(writeCtx, websocket.MessageText, event.JSON()); err != nil {
				writeCancel()
				return
			}
			writeCancel()
		}
	}
}
