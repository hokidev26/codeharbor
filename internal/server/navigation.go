package server

import (
	"net/http"

	"autoto/internal/db"
)

type navigationResponse struct {
	Projects      []db.Project                `json:"projects"`
	Conversations []db.NavigationConversation `json:"conversations"`
}

func (s *Server) navigation(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	conversations, err := s.store.ListNavigationConversations(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, navigationResponse{
		Projects:      projects,
		Conversations: conversations,
	})
}
