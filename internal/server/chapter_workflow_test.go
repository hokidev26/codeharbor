package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

func TestForkChapterCreatesGitWorktreeNarratorAndAllowsGitStatus(t *testing.T) {
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

	body := strings.NewReader(`{"title":"Feature Branch","branch":"feature/codeharbor-test"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/chapters/"+root.ID+"/fork", body)
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response forkChapterResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Chapter.ProjectID != project.ID || response.Chapter.ParentChapterID != root.ID || response.Chapter.Branch != "feature/codeharbor-test" || response.Chapter.WorktreePath == "" {
		t.Fatalf("unexpected fork response: %+v", response)
	}
	if response.Narrator.ChapterID != response.Chapter.ID || response.Narrator.CWD != response.Chapter.WorktreePath {
		t.Fatalf("unexpected fork narrator: %+v", response.Narrator)
	}
	if pathWithin(repo, response.Chapter.WorktreePath) {
		t.Fatalf("worktree should not be nested in source repo: %s", response.Chapter.WorktreePath)
	}
	branch := strings.TrimSpace(runGitTestOutput(t, response.Chapter.WorktreePath, "branch", "--show-current"))
	if branch != "feature/codeharbor-test" {
		t.Fatalf("expected fork branch, got %q", branch)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/narrators/"+response.Narrator.ID+"/git/status", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected fork narrator git status 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestChapterMergeMergesCleanSourceIntoTarget(t *testing.T) {
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
	fork := forkChapterForTest(t, app, root.ID, "feature/merge-success")
	writeGitTestFile(t, fork.Chapter.WorktreePath, "feature.txt", "merged feature\n")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "add", "feature.txt")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "commit", "-m", "feature change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/chapters/"+fork.Chapter.ID+"/merge", strings.NewReader(`{"targetChapterId":"`+root.ID+`","message":"Merge feature chapter"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response chapterMergeResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if !response.Merged || response.MergeCommit == "" || response.Chapter.Status != "merged" || response.Chapter.MergedIntoChapterID != root.ID {
		t.Fatalf("unexpected merge response: %+v", response)
	}
	if got := strings.TrimSpace(runGitTestOutput(t, repo, "show", "HEAD:feature.txt")); got != "merged feature" {
		t.Fatalf("expected merged feature file in target, got %q", got)
	}
	stored, err := store.GetChapter(ctx, fork.Chapter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != "merged" || stored.MergeCommitSHA != response.MergeCommit || stored.PreMergeTargetSHA == "" {
		t.Fatalf("expected merge metadata persisted, got %+v", stored)
	}
}

func TestChapterMergeRejectsConflictsAndAborts(t *testing.T) {
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
	fork := forkChapterForTest(t, app, root.ID, "conflict/merge")
	writeGitTestFile(t, repo, "README.md", "target change\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "target change")
	writeGitTestFile(t, fork.Chapter.WorktreePath, "README.md", "source change\n")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "add", "README.md")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "commit", "-m", "source change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/chapters/"+fork.Chapter.ID+"/merge", strings.NewReader(`{"targetChapterId":"`+root.ID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response chapterMergeResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Merged || !containsString(response.Conflicts, "README.md") {
		t.Fatalf("expected conflict response, got %+v", response)
	}
	if status := strings.TrimSpace(runGitTestOutput(t, repo, "status", "--porcelain")); status != "" {
		t.Fatalf("expected merge abort to leave target clean, got %q", status)
	}
	stored, err := store.GetChapter(ctx, fork.Chapter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status == "merged" || stored.MergeCommitSHA != "" {
		t.Fatalf("conflicted merge should not update chapter metadata: %+v", stored)
	}
}

func TestChapterMergeCheckReportsConflicts(t *testing.T) {
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
	fork := forkChapterForTest(t, app, root.ID, "conflict/source")

	writeGitTestFile(t, repo, "README.md", "target change\n")
	runGitTestCommand(t, repo, "add", "README.md")
	runGitTestCommand(t, repo, "commit", "-m", "target change")
	writeGitTestFile(t, fork.Chapter.WorktreePath, "README.md", "source change\n")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "add", "README.md")
	runGitTestCommand(t, fork.Chapter.WorktreePath, "commit", "-m", "source change")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/chapters/"+fork.Chapter.ID+"/merge-check?targetChapterId="+root.ID, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response chapterMergeCheckResponse
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

func forkChapterForTest(t *testing.T, app *Server, chapterID, branch string) forkChapterResponse {
	t.Helper()
	body := strings.NewReader(`{"title":"` + branch + `","branch":"` + branch + `"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/chapters/"+chapterID+"/fork", body)
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected fork 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response forkChapterResponse
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
