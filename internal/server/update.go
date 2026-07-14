package server

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
	updatepkg "autoto/internal/update"
)

const UpdateStatusPath = "/api/update/status"

const (
	UpdateStatusDevelopmentBuild = "development_build"
	UpdateStatusUnavailable      = "unavailable"
	UpdateStatusUpToDate         = "up_to_date"
	UpdateStatusAvailable        = "update_available"
)

// UpdateStatusResponse reports only locally computed, inert update metadata.
type UpdateStatusResponse struct {
	Status          string           `json:"status"`
	Available       bool             `json:"available"`
	CurrentVersion  string           `json:"currentVersion"`
	TargetVersion   string           `json:"targetVersion,omitempty"`
	Channel         string           `json:"channel,omitempty"`
	RequiresBackup  bool             `json:"requiresBackup,omitempty"`
	RequiresRestart bool             `json:"requiresRestart,omitempty"`
	Path            []updatepkg.Edge `json:"path,omitempty"`
	Reason          string           `json:"reason,omitempty"`
}

type updateStatusState struct {
	currentVersion string
	channel        string
	manifest       *updatepkg.Manifest
	trusted        bool
	manifestError  error
}

var updateStatusStates sync.Map

// SetTrustedUpdateManifest injects a caller-trusted manifest after validating
// it. This method performs no network access and does not fetch artifacts.
func (s *Server) SetTrustedUpdateManifest(manifest updatepkg.Manifest) error {
	return s.configureUpdateStatus(config.Version, manifest.Channel, &manifest, true)
}

// SetUpdateManifestForTesting accepts a Manifest, *Manifest, JSON bytes, JSON
// string, or nil so tests can inject metadata without a network dependency.
func (s *Server) SetUpdateManifestForTesting(manifest any) error {
	parsed, err := coerceUpdateManifest(manifest)
	if err != nil {
		updateStatusStates.Store(s, updateStatusState{currentVersion: config.Version, manifestError: err})
		return err
	}
	channel := ""
	if parsed != nil {
		channel = parsed.Channel
	}
	return s.configureUpdateStatus(config.Version, channel, parsed, true)
}

// ConfigureUpdateStatusForTesting also overrides the local build version and
// channel, allowing stable-build status behavior to be tested independently.
func (s *Server) ConfigureUpdateStatusForTesting(currentVersion, channel string, manifest any) error {
	parsed, err := coerceUpdateManifest(manifest)
	if err != nil {
		updateStatusStates.Store(s, updateStatusState{currentVersion: currentVersion, channel: channel, manifestError: err})
		return err
	}
	return s.configureUpdateStatus(currentVersion, channel, parsed, true)
}

// ClearUpdateManifestForTesting removes all injected update state.
func (s *Server) ClearUpdateManifestForTesting() {
	updateStatusStates.Delete(s)
}

func (s *Server) configureUpdateStatus(currentVersion, channel string, manifest *updatepkg.Manifest, trusted bool) error {
	state := updateStatusState{currentVersion: strings.TrimSpace(currentVersion), channel: strings.TrimSpace(channel), trusted: trusted}
	if manifest == nil {
		state.trusted = false
		updateStatusStates.Store(s, state)
		return nil
	}
	if err := updatepkg.ValidateManifest(*manifest); err != nil {
		state.manifestError = err
		state.trusted = false
		updateStatusStates.Store(s, state)
		return err
	}
	copy := *manifest
	copy.Edges = append([]updatepkg.Edge(nil), manifest.Edges...)
	for index := range copy.Edges {
		copy.Edges[index].Notes = append(updatepkg.Notes(nil), manifest.Edges[index].Notes...)
	}
	state.manifest = &copy
	updateStatusStates.Store(s, state)
	return nil
}

func coerceUpdateManifest(value any) (*updatepkg.Manifest, error) {
	switch manifest := value.(type) {
	case nil:
		return nil, nil
	case updatepkg.Manifest:
		copy := manifest
		return &copy, nil
	case *updatepkg.Manifest:
		if manifest == nil {
			return nil, nil
		}
		copy := *manifest
		return &copy, nil
	case []byte:
		parsed, err := updatepkg.ParseManifest(manifest)
		if err != nil {
			return nil, err
		}
		return &parsed, nil
	case string:
		parsed, err := updatepkg.ParseManifest([]byte(manifest))
		if err != nil {
			return nil, err
		}
		return &parsed, nil
	default:
		return nil, fmt.Errorf("unsupported update manifest injection type %T", value)
	}
}

// MountUpdateRoutes mounts the update endpoint on an existing chi-compatible
// router. Keeping this hook in update.go preserves the update skeleton's file
// boundary while allowing a future composition point to opt in explicitly.
func (s *Server) MountUpdateRoutes(router interface {
	Get(string, http.HandlerFunc)
}) {
	router.Get(UpdateStatusPath, s.updateStatus)
}

// UpdateRoutes returns a standalone, guarded router for the update endpoint.
func (s *Server) UpdateRoutes() http.Handler {
	router := chi.NewRouter()
	router.Use(s.localRequestGuard)
	s.MountUpdateRoutes(router)
	return router
}

func (s *Server) updateStatus(w http.ResponseWriter, r *http.Request) {
	s.UpdateStatus(w, r)
}

// UpdateStatus serves GET /api/update/status. It only validates and plans
// metadata; it never downloads or executes anything.
func (s *Server) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setNoStore(w)
	writeJSON(w, http.StatusOK, s.updateStatusResponse())
}

func (s *Server) updateStatusResponse() UpdateStatusResponse {
	state := updateStatusState{currentVersion: config.Version}
	if injected, ok := updateStatusStates.Load(s); ok {
		state = injected.(updateStatusState)
	}
	currentVersion := strings.TrimSpace(state.currentVersion)
	if currentVersion == "" {
		currentVersion = config.Version
	}
	response := UpdateStatusResponse{CurrentVersion: currentVersion}
	if updatepkg.IsDevelopmentVersion(currentVersion) {
		response.Status = UpdateStatusDevelopmentBuild
		response.Reason = "development builds do not claim update availability"
		return response
	}
	if !state.trusted || state.manifest == nil {
		response.Status = UpdateStatusUnavailable
		if state.manifestError != nil {
			response.Reason = "trusted update manifest is invalid"
		} else {
			response.Reason = "no trusted update manifest is configured"
		}
		return response
	}

	planner, err := updatepkg.NewPlanner(*state.manifest)
	if err != nil {
		response.Status = UpdateStatusUnavailable
		response.Reason = "trusted update manifest is invalid"
		return response
	}
	plan, err := planner.Plan(currentVersion, "", state.channel)
	if err != nil {
		response.Status = UpdateStatusUnavailable
		response.Reason = "no validated update path is available"
		return response
	}
	response.Channel = plan.Channel
	response.TargetVersion = plan.TargetVersion
	if len(plan.Steps) == 0 {
		response.Status = UpdateStatusUpToDate
		return response
	}
	response.Status = UpdateStatusAvailable
	response.Available = true
	response.RequiresBackup = plan.RequiresBackup
	response.RequiresRestart = plan.RequiresRestart
	response.Path = plan.Steps
	return response
}
