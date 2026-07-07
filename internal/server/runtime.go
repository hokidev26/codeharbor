package server

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

type runtimeSummaryResponse struct {
	GeneratedAt string                `json:"generatedAt"`
	Version     string                `json:"version"`
	Server      runtimeServerSummary  `json:"server"`
	Process     runtimeProcessSummary `json:"process"`
	Go          runtimeGoSummary      `json:"go"`
	Memory      runtimeMemorySummary  `json:"memory"`
	Paths       []runtimePathSummary  `json:"paths"`
	Agent       runtimeAgentSummary   `json:"agent"`
	Providers   runtimeProviderStats  `json:"providers"`
	Backends    runtimeBackendStats   `json:"backends"`
}

type runtimeServerSummary struct {
	Address    string `json:"address"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	ConfigPath string `json:"configPath,omitempty"`
}

type runtimeProcessSummary struct {
	PID           int    `json:"pid"`
	Executable    string `json:"executable,omitempty"`
	StartedAt     string `json:"startedAt"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
}

type runtimeGoSummary struct {
	Version    string `json:"version"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	CPUs       int    `json:"cpus"`
	Goroutines int    `json:"goroutines"`
}

type runtimeMemorySummary struct {
	AllocBytes      uint64 `json:"allocBytes"`
	TotalAllocBytes uint64 `json:"totalAllocBytes"`
	SysBytes        uint64 `json:"sysBytes"`
	HeapAllocBytes  uint64 `json:"heapAllocBytes"`
	HeapInuseBytes  uint64 `json:"heapInuseBytes"`
	StackInuseBytes uint64 `json:"stackInuseBytes"`
	NextGCBytes     uint64 `json:"nextGcBytes"`
	GCCycles        uint32 `json:"gcCycles"`
}

type runtimePathSummary struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Path  string `json:"path"`
}

type runtimeAgentSummary struct {
	DefaultModel           string `json:"defaultModel"`
	SummaryModel           string `json:"summaryModel"`
	DefaultPermissionMode  string `json:"defaultPermissionMode"`
	DefaultStartInPlanMode bool   `json:"defaultStartInPlanMode"`
	MaxTurns               int    `json:"maxTurns"`
	FirstTokenTimeoutMs    int    `json:"firstTokenTimeoutMs"`
	MaxTransientRetries    int    `json:"maxTransientRetries"`
}

type runtimeProviderStats struct {
	Total      int `json:"total"`
	Configured int `json:"configured"`
}

type runtimeBackendStats struct {
	Configured int `json:"configured"`
	Active     int `json:"active"`
}

func (s *Server) runtimeSummary(w http.ResponseWriter, r *http.Request) {
	summary := buildRuntimeSummary(s.configSnapshot(), s.configPathSnapshot(), s.startedAt)
	writeJSON(w, http.StatusOK, summary)
}

func buildRuntimeSummary(cfg config.Config, configPath string, startedAt time.Time) runtimeSummaryResponse {
	now := time.Now().UTC()
	if startedAt.IsZero() {
		startedAt = now
	}
	startedAt = startedAt.UTC()
	if configPath == "" {
		configPath = effectiveConfigPath(cfg, "")
	}

	uptimeSeconds := int64(now.Sub(startedAt).Seconds())
	if uptimeSeconds < 0 {
		uptimeSeconds = 0
	}

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	executable, _ := os.Executable()
	providers := cfg.Providers.Summaries()
	providerStats := runtimeProviderStats{Total: len(providers)}
	for _, provider := range providers {
		if provider.Configured {
			providerStats.Configured++
		}
	}
	backendStats := runtimeBackendStats{Configured: len(cfg.Backends.Instances)}
	for _, backend := range cfg.Backends.Instances {
		if backend.Active {
			backendStats.Active++
		}
	}

	return runtimeSummaryResponse{
		GeneratedAt: db.Now(),
		Version:     config.Version,
		Server: runtimeServerSummary{
			Address:    runtimeServerAddress(cfg),
			Host:       runtimeServerHost(cfg),
			Port:       runtimeServerPort(cfg),
			ConfigPath: configPath,
		},
		Process: runtimeProcessSummary{
			PID:           os.Getpid(),
			Executable:    executable,
			StartedAt:     startedAt.Format(time.RFC3339Nano),
			UptimeSeconds: uptimeSeconds,
		},
		Go: runtimeGoSummary{
			Version:    runtime.Version(),
			OS:         runtime.GOOS,
			Arch:       runtime.GOARCH,
			CPUs:       runtime.NumCPU(),
			Goroutines: runtime.NumGoroutine(),
		},
		Memory: runtimeMemorySummary{
			AllocBytes:      mem.Alloc,
			TotalAllocBytes: mem.TotalAlloc,
			SysBytes:        mem.Sys,
			HeapAllocBytes:  mem.HeapAlloc,
			HeapInuseBytes:  mem.HeapInuse,
			StackInuseBytes: mem.StackInuse,
			NextGCBytes:     mem.NextGC,
			GCCycles:        mem.NumGC,
		},
		Paths: []runtimePathSummary{
			{Key: "home", Label: "CodeHarbor home", Path: cfg.Paths.HomeDir},
			{Key: "database", Label: "SQLite database", Path: cfg.Paths.DatabasePath},
			{Key: "config", Label: "Config file", Path: configPath},
			{Key: "projects", Label: "Default project directory", Path: cfg.Paths.DefaultProjectDir},
		},
		Agent: runtimeAgentSummary{
			DefaultModel:           cfg.Agent.DefaultModel,
			SummaryModel:           cfg.Agent.SummaryModel,
			DefaultPermissionMode:  cfg.Agent.DefaultPermissionMode,
			DefaultStartInPlanMode: cfg.Agent.DefaultStartInPlanMode,
			MaxTurns:               cfg.Agent.MaxTurns,
			FirstTokenTimeoutMs:    cfg.Agent.FirstTokenTimeoutMs,
			MaxTransientRetries:    cfg.Agent.MaxTransientRetries,
		},
		Providers: providerStats,
		Backends:  backendStats,
	}
}

func runtimeServerAddress(cfg config.Config) string {
	return fmt.Sprintf("%s:%d", runtimeServerHost(cfg), runtimeServerPort(cfg))
}

func runtimeServerHost(cfg config.Config) string {
	host := strings.TrimSpace(cfg.Server.Host)
	if host == "" {
		return "localhost"
	}
	return host
}

func runtimeServerPort(cfg config.Config) int {
	if cfg.Server.Port == 0 {
		return 7788
	}
	return cfg.Server.Port
}
