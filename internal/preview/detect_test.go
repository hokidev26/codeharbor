package preview

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDetectFindsOnlySupportedShallowProfiles(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "index.html"), "<h1>root</h1>")
	writeTestFile(t, filepath.Join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
	writeTestFile(t, filepath.Join(root, "apps", "vite-app", "package.json"), `{"devDependencies":{"vite":"5.0.0"}}`)
	writeTestFile(t, filepath.Join(root, "apps", "vite-app", "vite.config.ts"), "export default {}\n")
	writeTestFile(t, filepath.Join(root, "packages", "next-app", "package.json"), `{"dependencies":{"next":"15.0.0"}}`)
	writeTestFile(t, filepath.Join(root, "examples", "static-site", "index.html"), "example")
	writeTestFile(t, filepath.Join(root, "apps", ".hidden", "package.json"), `{"devDependencies":{"vite":"5.0.0"}}`)
	writeTestFile(t, filepath.Join(root, "apps", "node_modules", "package.json"), `{"dependencies":{"next":"15.0.0"}}`)
	writeTestFile(t, filepath.Join(root, "apps", "too", "deep", "package.json"), `{"devDependencies":{"vite":"5.0.0"}}`)
	if err := os.Symlink(filepath.Join(root, "apps", "vite-app"), filepath.Join(root, "apps", "linked-app")); err != nil {
		t.Logf("symlink unavailable: %v", err)
	}

	profiles, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	expectedProfiles := 4
	if !dynamicSupported() {
		expectedProfiles = 2
	}
	if len(profiles) != expectedProfiles {
		t.Fatalf("expected %d supported profiles, got %d: %+v", expectedProfiles, len(profiles), profiles)
	}
	counts := map[string]int{}
	for _, profile := range profiles {
		counts[profile.Kind]++
		if profile.ID == "" || profile.Label == "" {
			t.Fatalf("profile must include id, label, and kind: %+v", profile)
		}
		decoded, err := hex.DecodeString(profile.ID)
		if err != nil || len(decoded) != 32 {
			t.Fatalf("profile id must be a SHA256 digest: %q", profile.ID)
		}
		if strings.Contains(profile.Label, root) {
			t.Fatalf("profile label leaked absolute workspace path: %q", profile.Label)
		}
	}
	if counts[KindStatic] != 2 {
		t.Fatalf("unexpected detected static profiles: %+v", counts)
	}
	if dynamicSupported() && (counts[KindVite] != 1 || counts[KindNext] != 1) {
		t.Fatalf("unexpected detected dynamic profiles: %+v", counts)
	}
}

func TestDetectFingerprintChangesWithInputs(t *testing.T) {
	if !dynamicSupported() {
		t.Skip("dynamic profiles are not supported on this platform")
	}
	root := t.TempDir()
	packagePath := filepath.Join(root, "package.json")
	lockPath := filepath.Join(root, "package-lock.json")
	configPath := filepath.Join(root, "vite.config.js")
	writeTestFile(t, packagePath, `{"devDependencies":{"vite":"5.0.0"}}`)
	writeTestFile(t, lockPath, `{"lockfileVersion":3}`)
	writeTestFile(t, configPath, "export default {}\n")

	first := mustProfileByKind(t, root, KindVite).ID
	writeTestFile(t, packagePath, `{"devDependencies":{"vite":"6.0.0"}}`)
	second := mustProfileByKind(t, root, KindVite).ID
	if first == second {
		t.Fatal("expected package.json change to invalidate fingerprint")
	}
	writeTestFile(t, lockPath, `{"lockfileVersion":4}`)
	third := mustProfileByKind(t, root, KindVite).ID
	if second == third {
		t.Fatal("expected lockfile change to invalidate fingerprint")
	}
	writeTestFile(t, configPath, "export default { server: {} }\n")
	fourth := mustProfileByKind(t, root, KindVite).ID
	if third == fourth {
		t.Fatal("expected config change to invalidate fingerprint")
	}
}

func TestDetectLimitsPackageJSONSize(t *testing.T) {
	root := t.TempDir()
	oversized := `{"devDependencies":{"vite":"5.0.0"},"padding":"` + strings.Repeat("x", maxPackageJSONSize) + `"}`
	writeTestFile(t, filepath.Join(root, "package.json"), oversized)
	writeTestFile(t, filepath.Join(root, "index.html"), "static remains valid")

	profiles, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].Kind != KindStatic {
		t.Fatalf("oversized package.json must not produce a dynamic profile: %+v", profiles)
	}
}

func mustProfileByKind(t *testing.T, root, kind string) Profile {
	t.Helper()
	profiles, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, profile := range profiles {
		if profile.Kind == kind {
			return profile
		}
	}
	t.Fatalf("profile %q not found in %+v", kind, profiles)
	return Profile{}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
