package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

func TestGitStatusRouteReturnsChangedFiles(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	writeGitTestFile(t, repo, "untracked file.txt", "new\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/status", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body gitStatusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.RepoRoot != repo || body.Clean || len(body.Files) != 2 {
		t.Fatalf("unexpected status body: %+v", body)
	}
	if !gitStatusHasPath(body.Files, "tracked.txt") || !gitStatusHasPath(body.Files, "untracked file.txt") {
		t.Fatalf("expected tracked and untracked files, got %+v", body.Files)
	}
}

func TestGitDiffRouteReturnsPatchForPath(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/diff?scope=all&path=tracked.txt", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body gitDiffResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Patch, "diff --git") || !strings.Contains(body.Patch, "+two") {
		t.Fatalf("expected patch to contain diff and new line, got %q", body.Patch)
	}
	if len(body.Files) != 1 || body.Files[0].Path != "tracked.txt" || body.Files[0].Added == 0 {
		t.Fatalf("unexpected diff files: %+v", body.Files)
	}
}

func TestGitDiffRouteHandlesUnbornHead(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "new.txt", "new\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/diff?scope=all&path=new.txt", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body gitDiffResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Path != "new.txt" || body.Scope != "all" {
		t.Fatalf("unexpected diff body: %+v", body)
	}
}

func TestGitLogRouteReturnsCommitsAndBoundsLimit(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial subject")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/log?limit=9999", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body gitLogResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Commits) != 1 || body.Commits[0].Subject != "initial subject" || body.Commits[0].ShortHash == "" {
		t.Fatalf("unexpected log body: %+v", body)
	}
}

func TestGitCommitRouteCommitsSelectedPaths(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	writeGitTestFile(t, repo, "other.txt", "base\n")
	runGitTestCommand(t, repo, "add", "tracked.txt", "other.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	writeGitTestFile(t, repo, "other.txt", "base\nlocal\n")
	writeGitTestFile(t, repo, "new.txt", "new\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"commit selected paths","paths":["tracked.txt","new.txt"]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body gitCommitResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Commit.Subject != "commit selected paths" || body.Commit.ShortHash == "" {
		t.Fatalf("unexpected commit body: %+v", body)
	}
	status := runGitTestOutput(t, repo, "status", "--porcelain=v1", "--untracked-files=all")
	if !strings.Contains(status, "other.txt") {
		t.Fatalf("expected unselected file to remain dirty, got %q", status)
	}
	if strings.Contains(status, "tracked.txt") || strings.Contains(status, "new.txt") {
		t.Fatalf("expected selected files to be committed, got %q", status)
	}
}

func TestGitCommitRouteRejectsEmptyMessage(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"   ","paths":["tracked.txt"]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGitCommitRouteRejectsEmptyPaths(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"commit","paths":[]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGitCommitRouteRejectsEscapingPath(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"commit","paths":["../secret.txt"]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGitCommitRouteRejectsSensitivePath(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, ".env", "TOKEN=secret\n")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"commit env","paths":[".env"]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
	status := runGitTestOutput(t, repo, "status", "--porcelain=v1", "--untracked-files=all")
	if !strings.Contains(status, ".env") {
		t.Fatalf("expected sensitive file to remain untracked, got %q", status)
	}
}

func TestGitCommitRouteRejectsStagedOutsideSelection(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	writeGitTestFile(t, repo, "other.txt", "base\n")
	runGitTestCommand(t, repo, "add", "tracked.txt", "other.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	writeGitTestFile(t, repo, "tracked.txt", "one\ntwo\n")
	writeGitTestFile(t, repo, "other.txt", "base\nstaged\n")
	runGitTestCommand(t, repo, "add", "other.txt")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/git/commit", strings.NewReader(`{"message":"commit selected","paths":["tracked.txt"]}`))
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
	cached := runGitTestOutput(t, repo, "diff", "--cached", "--name-only")
	if !strings.Contains(cached, "other.txt") {
		t.Fatalf("expected pre-staged file to remain staged, got %q", cached)
	}
}

func TestGitStatusRouteRejectsNonGitRepo(t *testing.T) {
	ctx := context.Background()
	store, narrator := newGitRouteStore(t, ctx, t.TempDir())
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/status", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGitDiffRouteRejectsEscapingPath(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "tracked.txt", "one\n")
	runGitTestCommand(t, repo, "add", "tracked.txt")
	runGitTestCommand(t, repo, "commit", "-m", "initial")
	store, narrator := newGitRouteStore(t, ctx, repo)
	defer store.Close()

	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/git/diff?path=../secret.txt", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func newGitRouteStore(t *testing.T, ctx context.Context, repo string) (*db.Store, db.Narrator) {
	t.Helper()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", repo, "openai:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, narrator
}

func newGitTestRepo(t *testing.T) string {
	t.Helper()
	repo := t.TempDir()
	resolved, err := filepath.EvalSymlinks(repo)
	if err == nil {
		repo = resolved
	}
	runGitTestCommand(t, repo, "init", "-b", "main")
	runGitTestCommand(t, repo, "config", "user.name", "CodeHarbor Test")
	runGitTestCommand(t, repo, "config", "user.email", "test@example.com")
	return repo
}

func writeGitTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func runGitTestCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(out))
	}
}

func runGitTestOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(out))
	}
	return string(out)
}

func gitStatusHasPath(files []gitStatusFile, path string) bool {
	for _, file := range files {
		if file.Path == path {
			return true
		}
	}
	return false
}
