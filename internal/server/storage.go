package server

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

const storageScanLimit = 5000

type storageSummaryResponse struct {
	GeneratedAt     string         `json:"generatedAt"`
	ScanLimit       int            `json:"scanLimit"`
	TotalKnownBytes int64          `json:"totalKnownBytes"`
	Entries         []storageEntry `json:"entries"`
}

type storageEntry struct {
	Key            string `json:"key"`
	Label          string `json:"label"`
	Path           string `json:"path"`
	Exists         bool   `json:"exists"`
	IsDir          bool   `json:"isDir"`
	SizeBytes      int64  `json:"sizeBytes"`
	FileCount      int64  `json:"fileCount"`
	DirectoryCount int64  `json:"directoryCount"`
	EntriesScanned int64  `json:"entriesScanned"`
	Truncated      bool   `json:"truncated"`
	Error          string `json:"error,omitempty"`
}

func (s *Server) storageSummary(w http.ResponseWriter, r *http.Request) {
	cfg := s.configSnapshot()
	summary := buildStorageSummary(r.Context(), cfg, s.configPathSnapshot(), storageScanLimit)
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) configPathSnapshot() string {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.configPath
}

func buildStorageSummary(ctx context.Context, cfg config.Config, configPath string, scanLimit int) storageSummaryResponse {
	if scanLimit <= 0 {
		scanLimit = storageScanLimit
	}
	configPath = effectiveConfigPath(cfg, configPath)
	entries := []storageEntry{
		scanStoragePath(ctx, "home", "CodeHarbor home", cfg.Paths.HomeDir, scanLimit),
		scanDatabaseFiles("database", "SQLite database", cfg.Paths.DatabasePath),
		scanStoragePath(ctx, "config", "Config file", configPath, scanLimit),
		scanStoragePath(ctx, "projects", "Default project directory", cfg.Paths.DefaultProjectDir, scanLimit),
	}
	var total int64
	for _, entry := range entries {
		total += entry.SizeBytes
	}
	return storageSummaryResponse{GeneratedAt: db.Now(), ScanLimit: scanLimit, TotalKnownBytes: total, Entries: entries}
}

func effectiveConfigPath(cfg config.Config, configPath string) string {
	if configPath != "" {
		return configPath
	}
	if cfg.Paths.HomeDir != "" {
		return filepath.Join(cfg.Paths.HomeDir, "config.json")
	}
	return ""
}

func scanDatabaseFiles(key, label, path string) storageEntry {
	entry := storageEntry{Key: key, Label: label, Path: path}
	if path == "" {
		entry.Error = "path is not configured"
		return entry
	}
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Lstat(candidate)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			entry.Error = err.Error()
			continue
		}
		entry.Exists = true
		entry.FileCount++
		entry.EntriesScanned++
		if info.IsDir() {
			entry.DirectoryCount++
			continue
		}
		entry.SizeBytes += info.Size()
	}
	return entry
}

func scanStoragePath(ctx context.Context, key, label, path string, scanLimit int) storageEntry {
	entry := storageEntry{Key: key, Label: label, Path: path}
	if path == "" {
		entry.Error = "path is not configured"
		return entry
	}
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return entry
		}
		entry.Error = err.Error()
		return entry
	}
	entry.Exists = true
	entry.IsDir = info.IsDir()
	if !info.IsDir() {
		entry.FileCount = 1
		entry.EntriesScanned = 1
		entry.SizeBytes = info.Size()
		return entry
	}

	walkErr := filepath.WalkDir(path, func(current string, dirEntry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry.Error == "" {
				entry.Error = walkErr.Error()
			}
			return nil
		}
		select {
		case <-ctx.Done():
			entry.Error = ctx.Err().Error()
			return ctx.Err()
		default:
		}
		if entry.EntriesScanned >= int64(scanLimit) {
			entry.Truncated = true
			if dirEntry.IsDir() && current != path {
				return filepath.SkipDir
			}
			return fs.SkipAll
		}
		entry.EntriesScanned++
		if current == path {
			entry.DirectoryCount++
			return nil
		}
		info, err := dirEntry.Info()
		if err != nil {
			if entry.Error == "" {
				entry.Error = err.Error()
			}
			return nil
		}
		if info.IsDir() {
			entry.DirectoryCount++
			return nil
		}
		entry.FileCount++
		entry.SizeBytes += info.Size()
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, fs.SkipAll) && entry.Error == "" {
		entry.Error = walkErr.Error()
	}
	return entry
}
