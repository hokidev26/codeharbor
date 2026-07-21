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
	"time"
)

// PendingReplaceFile is written under the Autoto home directory after a
// user-confirmed local stage. Applying the replace is an explicit host-side
// step (restart helper / installer); this package never executes the binary.
const PendingReplaceFile = "desktop-update-pending.json"

// PendingReplace describes a staged desktop binary waiting for host apply.
type PendingReplace struct {
	Version    string    `json:"version"`
	StagedPath string    `json:"stagedPath"`
	SHA256     string    `json:"sha256"`
	SourcePath string    `json:"sourcePath,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// StageLocalBinary copies a local file into homeDir/updates/staged/ after an
// optional SHA-256 check. It does not download, install, or restart anything.
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
	info, err := os.Stat(sourcePath)
	if err != nil {
		return PendingReplace{}, err
	}
	if info.IsDir() {
		return PendingReplace{}, errors.New("source path must be a file")
	}
	if info.Size() <= 0 {
		return PendingReplace{}, errors.New("source file is empty")
	}
	// Hard cap: 512 MiB local artifact (prevents accidental huge copies).
	const maxBytes = 512 << 20
	if info.Size() > maxBytes {
		return PendingReplace{}, fmt.Errorf("source file too large (%d bytes)", info.Size())
	}

	sum, err := fileSHA256(sourcePath)
	if err != nil {
		return PendingReplace{}, err
	}
	if expectedSHA256 != "" && expectedSHA256 != sum {
		return PendingReplace{}, fmt.Errorf("sha256 mismatch: got %s want %s", sum, expectedSHA256)
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
	if err := copyFile(sourcePath, dest, 0o755); err != nil {
		return PendingReplace{}, err
	}

	pending := PendingReplace{
		Version:    version,
		StagedPath: dest,
		SHA256:     sum,
		SourcePath: sourcePath,
		CreatedAt:  time.Now().UTC(),
	}
	if err := WritePendingReplace(homeDir, pending); err != nil {
		_ = os.Remove(dest)
		return PendingReplace{}, err
	}
	return pending, nil
}

func WritePendingReplace(homeDir string, pending PendingReplace) error {
	path := filepath.Join(homeDir, PendingReplaceFile)
	data, err := json.MarshalIndent(pending, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
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
	path := filepath.Join(strings.TrimSpace(homeDir), PendingReplaceFile)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
