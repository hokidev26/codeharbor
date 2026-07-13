package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestForkWorklineCreatesGitWorktreeAgentAndAllowsGitStatus(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "README.md", "initial\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "initial")

	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, root, _, err := store.CreateProject(ctx, "Demo", "", repo, "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Agent: config.AgentConfig{DefaultModel: "openai:test", DefaultPermissionMode: "acceptEdits"}}, store, nil, nil)

	body := strings.NewReader(`{"title":"Feature Branch","branch":"feature/autoto-test"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/worklines/"+root.ID+"/fork", body)
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response forkWorklineResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Workline.ProjectID != project.ID || response.Workline.ParentWorklineID != root.ID || response.Workline.Branch != "feature/autoto-test" || response.Workline.WorktreePath == "" {
		t.Fatalf("unexpected fork response: %+v", response)
	}
	if response.Agent.WorklineID != response.Workline.ID || response.Agent.CWD != response.Workline.WorktreePath {
		t.Fatalf("unexpected fork agent: %+v", response.Agent)
	}
	if pathWithin(repo, response.Workline.WorktreePath) {
		t.Fatalf("worktree should not be nested in source repo: %s", response.Workline.WorktreePath)
	}
	if !pathWithin(filepath.Join(filepath.Dir(repo), ".autoto-worktrees", "demo"), response.Workline.WorktreePath) {
		t.Fatalf("expected Autoto worktree directory, got %s", response.Workline.WorktreePath)
	}
	branch := strings.TrimSpace(runGitTestOutput(t, response.Workline.WorktreePath, "branch", "--show-current"))
	if branch != "feature/autoto-test" {
		t.Fatalf("expected fork branch, got %q", branch)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/agents/"+response.Agent.ID+"/git/status", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected fork agent git status 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestDefaultWorklineBranchUsesAutotoPrefix(t *testing.T) {
	if branch := defaultWorklineBranch("Feature Branch"); !strings.HasPrefix(branch, "autoto/") {
		t.Fatalf("expected Autoto branch prefix, got %q", branch)
	}
}

func TestLegacyAgentWorklineRoutesAliasCanonicalHandlers(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, workline, agent, err := store.CreateProject(ctx, "Legacy routes", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{}, store, nil, nil)
	for _, path := range []string{
		"/api/projects/" + project.ID + "/chapters",
		"/api/chapters/" + workline.ID,
		"/api/chapters/" + workline.ID + "/narrators",
		"/api/narrators/" + agent.ID,
	} {
		recorder := httptest.NewRecorder()
		app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("legacy alias %s returned %d: %s", path, recorder.Code, recorder.Body.String())
		}
	}
}

func TestWorklineMergeMergesCleanSourceIntoTarget(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "README.md", "base\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "base")

	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, root, _, err := store.CreateProject(ctx, "Demo", "", repo, "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Agent: config.AgentConfig{DefaultModel: "openai:test", DefaultPermissionMode: "acceptEdits"}}, store, nil, nil)
	fork := forkWorklineForTest(t, app, root.ID, "feature/merge-success")
	writeGitTestFile(t, fork.Workline.WorktreePath, "feature.txt", "merged feature\n")
	runGitTestCommand(t, fork.Workline.WorktreePath, "add", "feature.txt")
	runGitTestCommand(t, fork.Workline.WorktreePath, "commit", "-m", "feature change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/worklines/"+fork.Workline.ID+"/merge", strings.NewReader(`{"targetWorklineId":"`+root.ID+`","message":"Merge feature workline"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response worklineMergeResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if !response.Merged || response.MergeCommit == "" || response.Workline.Status != "merged" || response.Workline.MergedIntoWorklineID != root.ID {
		t.Fatalf("unexpected merge response: %+v", response)
	}
	if got := strings.TrimSpace(runGitTestOutput(t, repo, "show", "HEAD:feature.txt")); got != "merged feature" {
		t.Fatalf("expected merged feature file in target, got %q", got)
	}
	stored, err := store.GetWorkline(ctx, fork.Workline.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != "merged" || stored.MergeCommitSHA != response.MergeCommit || stored.PreMergeTargetSHA == "" {
		t.Fatalf("expected merge metadata persisted, got %+v", stored)
	}
}

func TestWorklineMergeRejectsConflictsAndAborts(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "README.md", "base\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "base")

	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, root, _, err := store.CreateProject(ctx, "Demo", "", repo, "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Agent: config.AgentConfig{DefaultModel: "openai:test", DefaultPermissionMode: "acceptEdits"}}, store, nil, nil)
	fork := forkWorklineForTest(t, app, root.ID, "conflict/merge")
	writeGitTestFile(t, repo, "README.md", "target change\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "target change")
	writeGitTestFile(t, fork.Workline.WorktreePath, "README.md", "source change\n")
	runGitTestCommand(t, fork.Workline.WorktreePath, "add", "README.md")
	runGitTestCommand(t, fork.Workline.WorktreePath, "commit", "-m", "source change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/worklines/"+fork.Workline.ID+"/merge", strings.NewReader(`{"targetWorklineId":"`+root.ID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response worklineMergeResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Merged || !containsString(response.Conflicts, "README.md") {
		t.Fatalf("expected conflict response, got %+v", response)
	}
	if status := strings.TrimSpace(runGitTestOutput(t, repo, "status", "--porcelain")); status != "" {
		t.Fatalf("expected merge abort to leave target clean, got %q", status)
	}
	stored, err := store.GetWorkline(ctx, fork.Workline.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status == "merged" || stored.MergeCommitSHA != "" {
		t.Fatalf("conflicted merge should not update workline metadata: %+v", stored)
	}
}

func TestWorklineMergeCheckReportsConflicts(t *testing.T) {
	ctx := context.Background()
	repo := newGitTestRepo(t)
	writeGitTestFile(t, repo, "README.md", "base\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "base")

	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, root, _, err := store.CreateProject(ctx, "Demo", "", repo, "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Agent: config.AgentConfig{DefaultModel: "openai:test", DefaultPermissionMode: "acceptEdits"}}, store, nil, nil)
	fork := forkWorklineForTest(t, app, root.ID, "conflict/source")

	writeGitTestFile(t, repo, "README.md", "target change\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "target change")
	writeGitTestFile(t, fork.Workline.WorktreePath, "README.md", "source change\n")
	runGitTestCommand(t, fork.Workline.WorktreePath, "add", "README.md")
	runGitTestCommand(t, fork.Workline.WorktreePath, "commit", "-m", "source change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/worklines/"+fork.Workline.ID+"/merge-check?targetWorklineId="+root.ID, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response worklineMergeCheckResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.CanMerge {
		t.Fatalf("expected conflict response, got %+v", response)
	}
	if !containsString(response.Conflicts, "README.md") {
		t.Fatalf("expected README.md conflict, got %+v", response)
	}
}

func forkWorklineForTest(t *testing.T, app *Server, worklineID, branch string) forkWorklineResponse {
	t.Helper()
	body := strings.NewReader(`{"title":"` + branch + `","branch":"` + branch + `"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/worklines/"+worklineID+"/fork", body)
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected fork 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response forkWorklineResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return response
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
