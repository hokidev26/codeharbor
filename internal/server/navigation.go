package server

import (
	"net/http"
	"strings"

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
	includeArchived := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("includeArchived")), "true") || strings.TrimSpace(r.URL.Query().Get("includeArchived")) == "1"
	var projects []db.Project
	if hasUsers {
		user, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		projects, err = s.store.ListProjectsForUserWithOptions(r.Context(), user.ID, includeArchived)
	} else {
		projects, err = s.store.ListProjectsWithOptions(r.Context(), includeArchived)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	conversations, err := s.store.ListNavigationConversationsWithOptions(r.Context(), includeArchived)
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
	visibleProjects := make([]db.Project, 0, len(projects))
	for _, project := range projects {
		if project.FlowMode != db.ProjectFlowModeConversation {
			visibleProjects = append(visibleProjects, project)
		}
	}
	writeJSON(w, http.StatusOK, navigationResponse{
		Projects:      s.filterProjectsForRequest(r, visibleProjects),
		Conversations: s.filterNavigationConversationsForRequest(r, conversations),
	})
}
