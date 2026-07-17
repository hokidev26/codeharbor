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
	hasUsers, err := s.store.HasUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var projects []db.Project
	if hasUsers {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		projects, err = s.store.ListProjectsForUser(r.Context(), user.ID)
	} else {
		projects, err = s.store.ListProjects(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	conversations, err := s.store.ListNavigationConversations(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hasUsers {
		allowedProjects := make(map[string]struct{}, len(projects))
		for _, project := range projects {
			allowedProjects[project.ID] = struct{}{}
		}
		filtered := make([]db.NavigationConversation, 0, len(conversations))
		for _, conversation := range conversations {
			if _, ok := allowedProjects[conversation.ProjectID]; ok {
				filtered = append(filtered, conversation)
			}
		}
		conversations = filtered
	}
	writeJSON(w, http.StatusOK, navigationResponse{
		Projects:      s.filterProjectsForRequest(r, projects),
		Conversations: s.filterNavigationConversationsForRequest(r, conversations),
	})
}
