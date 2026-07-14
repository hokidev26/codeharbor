package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	agentpkg "autoto/internal/agent"
	"autoto/internal/db"
)

func requireLocalExecutionAgent(agent db.Agent) error {
	deviceID := strings.TrimSpace(agent.ExecutionDeviceID)
	if deviceID == "" || deviceID == "local" {
		return nil
	}
	return fmt.Errorf("%w: agent targets a remote execution device", agentpkg.ErrRemoteExecutionUnavailable)
}

func writeExecutionGuardError(w http.ResponseWriter, err error) {
	if errors.Is(err, agentpkg.ErrRemoteExecutionUnavailable) {
		writeError(w, http.StatusConflict, "remote execution transport is disabled; local fallback is forbidden")
		return
	}
	writeStoreError(w, err)
}
