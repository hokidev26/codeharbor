package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// PendingReplaceFile is written under the Autoto home directory after a
// successful local stage. Apply is always out-of-band (host restart helper).
const PendingReplaceFile = "desktop-update-pending.json"

// PendingReplace describes a staged desktop binary waiting for host apply.
type PendingReplace struct {
	Version    string    `json:"version"`
	StagedPath string    `json:"stagedPath"`
	SHA256     string    `json:"sha256"`
	SourcePath string    `json:"sourcePath,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

var stageMu sync.Mutex

// StageLocalBinary copies a local file into homeDir/updates/staged/ after an
// optional expected SHA-256 check. The source is opened once; hashing, size
// limits, and the staged bytes all share that single open to avoid TOCTOU.
func StageLocalBinary(homeDir, sourcePath, version, expectedSHA256 string) (PendingReplace, error) {
	homeDir = strings.TrimSpace(homeDir)
	sourcePath = strings.TrimSpace(sourcePath)
	version = strings.TrimSpace(version)
	expectedSHA256 = strings.ToLower(strings.TrimSpace(expectedSHA256))
	if homeDir == "" {
		return PendingReplace{}, errors.New("home directory is required")
	}
	if sourcePath == "" {
		return PendingReplace{}, errors.New("source path is required")
	}
	if version == "" {
		return PendingReplace{}, errors.New("version is required")
	}
	if strings.Contains(version, "..") || strings.ContainsAny(version, `/\`) {
		return PendingReplace{}, errors.New("version must not contain path separators")
	}
	if expectedSHA256 != "" && !isSHA256Hex(expectedSHA256) {
		return PendingReplace{}, errors.New("sha256 must be a 64-character lowercase hex digest")
	}

	stageMu.Lock()
	defer stageMu.Unlock()

	in, err := os.Open(sourcePath)
	if err != nil {
		return PendingReplace{}, err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return PendingReplace{}, err
	}
	if info.IsDir() {
		return PendingReplace{}, errors.New("source path must be a file")
	}
	if info.Size() <= 0 {
		return PendingReplace{}, errors.New("source file is empty")
	}
	const maxBytes = 512 << 20
	if info.Size() > maxBytes {
		return PendingReplace{}, fmt.Errorf("source file too large (%d bytes)", info.Size())
	}

	stageDir := filepath.Join(homeDir, "updates", "staged")
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		return PendingReplace{}, err
	}
	base := filepath.Base(sourcePath)
	if base == "." || base == string(filepath.Separator) {
		base = "autoto-desktop"
	}
	dest := filepath.Join(stageDir, fmt.Sprintf("%s-%s", version, base))

	tmp, err := os.CreateTemp(stageDir, ".stage-*.tmp")
	if err != nil {
		return PendingReplace{}, err
	}
	tmpName := tmp.Name()
	cleanupTmp := true
	defer func() {
		_ = tmp.Close()
		if cleanupTmp {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(0o755); err != nil {
		return PendingReplace{}, err
	}

	hasher := sha256.New()
	limited := io.LimitReader(in, maxBytes+1)
	written, err := io.Copy(io.MultiWriter(tmp, hasher), limited)
	if err != nil {
		return PendingReplace{}, err
	}
	if written <= 0 {
		return PendingReplace{}, errors.New("source file is empty")
	}
	if written > maxBytes {
		return PendingReplace{}, fmt.Errorf("source file too large (%d bytes)", written)
	}
	if err := tmp.Close(); err != nil {
		return PendingReplace{}, err
	}

	sum := hex.EncodeToString(hasher.Sum(nil))
	if expectedSHA256 != "" && expectedSHA256 != sum {
		return PendingReplace{}, fmt.Errorf("sha256 mismatch: got %s want %s", sum, expectedSHA256)
	}
	if err := os.Rename(tmpName, dest); err != nil {
		return PendingReplace{}, err
	}
	cleanupTmp = false

	pending := PendingReplace{
		Version:    version,
		StagedPath: dest,
		SHA256:     sum,
		SourcePath: sourcePath,
		CreatedAt:  time.Now().UTC(),
	}
	if err := writePendingReplaceLocked(homeDir, pending); err != nil {
		_ = os.Remove(dest)
		return PendingReplace{}, err
	}
	return pending, nil
}

func WritePendingReplace(homeDir string, pending PendingReplace) error {
	stageMu.Lock()
	defer stageMu.Unlock()
	return writePendingReplaceLocked(homeDir, pending)
}

func writePendingReplaceLocked(homeDir string, pending PendingReplace) error {
	path := filepath.Join(strings.TrimSpace(homeDir), PendingReplaceFile)
	data, err := json.MarshalIndent(pending, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".pending-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		_ = tmp.Close()
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func ReadPendingReplace(homeDir string) (PendingReplace, bool, error) {
	path := filepath.Join(strings.TrimSpace(homeDir), PendingReplaceFile)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return PendingReplace{}, false, nil
		}
		return PendingReplace{}, false, err
	}
	var pending PendingReplace
	if err := json.Unmarshal(data, &pending); err != nil {
		return PendingReplace{}, false, err
	}
	if strings.TrimSpace(pending.StagedPath) == "" || strings.TrimSpace(pending.Version) == "" {
		return PendingReplace{}, false, nil
	}
	if _, err := os.Stat(pending.StagedPath); err != nil {
		return PendingReplace{}, false, nil
	}
	return pending, true, nil
}

func ClearPendingReplace(homeDir string) error {
	stageMu.Lock()
	defer stageMu.Unlock()
	path := filepath.Join(strings.TrimSpace(homeDir), PendingReplaceFile)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func isSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}
