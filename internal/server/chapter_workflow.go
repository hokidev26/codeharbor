package server

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"codeharbor/internal/db"
)

const chapterGitOutputMaxBytes = 512 << 10

type forkChapterRequest struct {
	Title          string `json:"title"`
	Branch         string `json:"branch"`
	WorktreePath   string `json:"worktreePath"`
	Model          string `json:"model"`
	PermissionMode string `json:"permissionMode"`
}

type forkChapterResponse struct {
	Chapter   db.Chapter  `json:"chapter"`
	Narrator  db.Narrator `json:"narrator"`
	ForkPoint string      `json:"forkPoint"`
}

type chapterMergeCheckResponse struct {
	GeneratedAt     string   `json:"generatedAt"`
	SourceChapterID string   `json:"sourceChapterId"`
	TargetChapterID string   `json:"targetChapterId"`
	SourceBranch    string   `json:"sourceBranch,omitempty"`
	TargetBranch    string   `json:"targetBranch,omitempty"`
	SourceHead      string   `json:"sourceHead,omitempty"`
	TargetHead      string   `json:"targetHead,omitempty"`
	CanMerge        bool     `json:"canMerge"`
	Conflicts       []string `json:"conflicts,omitempty"`
	Output          string   `json:"output,omitempty"`
}

type chapterMergeRequest struct {
	TargetChapterID string `json:"targetChapterId"`
	Message         string `json:"message"`
}

type chapterMergeResponse struct {
	GeneratedAt     string     `json:"generatedAt"`
	SourceChapterID string     `json:"sourceChapterId"`
	TargetChapterID string     `json:"targetChapterId"`
	SourceHead      string     `json:"sourceHead,omitempty"`
	PreMergeTarget  string     `json:"preMergeTarget,omitempty"`
	MergeCommit     string     `json:"mergeCommit,omitempty"`
	Merged          bool       `json:"merged"`
	Conflicts       []string   `json:"conflicts,omitempty"`
	Output          string     `json:"output,omitempty"`
	Chapter         db.Chapter `json:"chapter,omitempty"`
}

func (s *Server) forkChapter(w http.ResponseWriter, r *http.Request) {
	parent, project, err := s.chapterAndProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	sourcePath := strings.TrimSpace(parent.WorktreePath)
	if sourcePath == "" {
		sourcePath = strings.TrimSpace(project.GitPath)
	}
	if sourcePath == "" {
		writeGitError(w, gitCommandError{Status: http.StatusBadRequest, Msg: "source chapter worktree is not configured"})
		return
	}
	if err := validateDir(sourcePath); err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	repoRoot, _, err := runGitCommand(r.Context(), sourcePath, 4096, 3*time.Second, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		writeGitError(w, err)
		return
	}
	repoRoot = strings.TrimSpace(repoRoot)
	if !s.projectAllowsRepoRoot(project, repoRoot) {
		writeGitError(w, gitCommandError{Status: http.StatusForbidden, Msg: "git repository is outside the configured project boundary"})
		return
	}
	baseRef, err := currentGitRef(r.Context(), repoRoot, parent)
	if err != nil {
		writeGitError(w, err)
		return
	}
	forkPoint, _, err := runGitCommand(r.Context(), repoRoot, 256, 3*time.Second, nil, "rev-parse", "HEAD")
	if err != nil {
		writeGitError(w, err)
		return
	}
	forkPoint = strings.TrimSpace(forkPoint)
	var req forkChapterRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Fork of " + parent.Title
	}
	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		branch = defaultChapterBranch(title)
	}
	branch, err = validateGitBranchName(r.Context(), repoRoot, branch)
	if err != nil {
		writeGitError(w, err)
		return
	}
	worktreePath, err := s.resolveForkWorktreePath(project, repoRoot, branch, req.WorktreePath)
	if err != nil {
		writeGitError(w, err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(worktreePath), 0o755); err != nil {
		writeGitError(w, err)
		return
	}
	if _, _, err := runGitCommand(r.Context(), repoRoot, chapterGitOutputMaxBytes, 15*time.Second, nil, "worktree", "add", "-b", branch, worktreePath, baseRef); err != nil {
		writeGitError(w, err)
		return
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		cfg := s.configSnapshot()
		model = cfg.Agent.DefaultModel
	}
	permissionMode := strings.TrimSpace(req.PermissionMode)
	if permissionMode == "" {
		permissionMode = s.safeDefaultPermissionModeForRequest(r, s.configSnapshot().Agent.DefaultPermissionMode)
	} else {
		var ok bool
		var message string
		permissionMode, ok, message = s.permissionModeAllowedForRequest(r, permissionMode)
		if !ok {
			_ = removeGitWorktree(context.Background(), repoRoot, worktreePath)
			writeError(w, http.StatusBadRequest, message)
			return
		}
	}
	chapter, narrator, err := s.store.CreateChapterFork(r.Context(), parent, title, branch, worktreePath, baseRef, forkPoint, model, permissionMode)
	if err != nil {
		_ = removeGitWorktree(context.Background(), repoRoot, worktreePath)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, forkChapterResponse{Chapter: chapter, Narrator: narrator, ForkPoint: forkPoint})
}

func (s *Server) chapterMergeCheck(w http.ResponseWriter, r *http.Request) {
	source, project, err := s.chapterAndProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	target, err := s.mergeTargetChapter(r.Context(), project.ID, r.URL.Query().Get("targetChapterId"))
	if err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	if source.ID == target.ID {
		writeError(w, http.StatusBadRequest, "source and target chapters must differ")
		return
	}
	_, sourceHead, err := s.chapterRepoAndHead(r.Context(), project, source)
	if err != nil {
		writeGitError(w, err)
		return
	}
	targetRepo, targetHead, err := s.chapterRepoAndHead(r.Context(), project, target)
	if err != nil {
		writeGitError(w, err)
		return
	}
	tempDir, err := os.MkdirTemp("", "codeharbor-merge-check-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.RemoveAll(tempDir)
	if _, _, err := runGitCommand(r.Context(), targetRepo, chapterGitOutputMaxBytes, 15*time.Second, nil, "worktree", "add", "--detach", tempDir, targetHead); err != nil {
		writeGitError(w, err)
		return
	}
	defer removeGitWorktree(context.Background(), targetRepo, tempDir)
	mergeOut, _, mergeErr := runGitCommand(r.Context(), tempDir, chapterGitOutputMaxBytes, 20*time.Second, nil, "merge", "--no-commit", "--no-ff", sourceHead)
	conflicts := mergeCheckConflicts(r.Context(), tempDir)
	if mergeErr != nil && len(conflicts) == 0 {
		writeGitError(w, mergeErr)
		return
	}
	writeJSON(w, http.StatusOK, chapterMergeCheckResponse{
		GeneratedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		SourceChapterID: source.ID,
		TargetChapterID: target.ID,
		SourceBranch:    source.Branch,
		TargetBranch:    target.Branch,
		SourceHead:      sourceHead,
		TargetHead:      targetHead,
		CanMerge:        mergeErr == nil && len(conflicts) == 0,
		Conflicts:       conflicts,
		Output:          strings.TrimSpace(mergeOut),
	})
}

func (s *Server) chapterMerge(w http.ResponseWriter, r *http.Request) {
	source, project, err := s.chapterAndProject(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	var req chapterMergeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target, err := s.mergeTargetChapter(r.Context(), project.ID, req.TargetChapterID)
	if err != nil {
		writeChapterWorkflowError(w, err)
		return
	}
	if source.ID == target.ID {
		writeError(w, http.StatusBadRequest, "source and target chapters must differ")
		return
	}
	sourceRepo, sourceHead, err := s.chapterRepoAndHead(r.Context(), project, source)
	if err != nil {
		writeGitError(w, err)
		return
	}
	targetRepo, targetHead, err := s.chapterRepoAndHead(r.Context(), project, target)
	if err != nil {
		writeGitError(w, err)
		return
	}
	if dirty, err := gitRepoDirty(r.Context(), sourceRepo); err != nil {
		writeGitError(w, err)
		return
	} else if dirty {
		writeGitError(w, gitCommandError{Status: http.StatusConflict, Msg: "source chapter worktree has uncommitted changes"})
		return
	}
	if dirty, err := gitRepoDirty(r.Context(), targetRepo); err != nil {
		writeGitError(w, err)
		return
	} else if dirty {
		writeGitError(w, gitCommandError{Status: http.StatusConflict, Msg: "target chapter worktree has uncommitted changes"})
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "Merge chapter " + source.Title
	}
	mergeOut, _, mergeErr := runGitCommand(r.Context(), targetRepo, chapterGitOutputMaxBytes, 30*time.Second, nil, "merge", "--no-ff", sourceHead, "-m", message)
	if mergeErr != nil {
		conflicts := mergeCheckConflicts(r.Context(), targetRepo)
		_ = abortGitMerge(context.Background(), targetRepo)
		if len(conflicts) > 0 {
			writeJSON(w, http.StatusConflict, chapterMergeResponse{GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano), SourceChapterID: source.ID, TargetChapterID: target.ID, SourceHead: sourceHead, PreMergeTarget: targetHead, Merged: false, Conflicts: conflicts, Output: strings.TrimSpace(mergeOut)})
			return
		}
		writeGitError(w, mergeErr)
		return
	}
	mergeCommit, _, err := runGitCommand(r.Context(), targetRepo, 256, 3*time.Second, nil, "rev-parse", "HEAD")
	if err != nil {
		writeGitError(w, err)
		return
	}
	mergeCommit = strings.TrimSpace(mergeCommit)
	updated, err := s.store.MarkChapterMerged(r.Context(), source.ID, target.ID, targetHead, mergeCommit, "no-ff")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, chapterMergeResponse{GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano), SourceChapterID: source.ID, TargetChapterID: target.ID, SourceHead: sourceHead, PreMergeTarget: targetHead, MergeCommit: mergeCommit, Merged: true, Output: strings.TrimSpace(mergeOut), Chapter: updated})
}

func (s *Server) chapterAndProject(ctx context.Context, chapterID string) (db.Chapter, db.Project, error) {
	chapter, err := s.store.GetChapter(ctx, chapterID)
	if err != nil {
		return db.Chapter{}, db.Project{}, err
	}
	project, err := s.store.GetProject(ctx, chapter.ProjectID)
	if err != nil {
		return db.Chapter{}, db.Project{}, err
	}
	return chapter, project, nil
}

func (s *Server) mergeTargetChapter(ctx context.Context, projectID, targetChapterID string) (db.Chapter, error) {
	targetChapterID = strings.TrimSpace(targetChapterID)
	if targetChapterID != "" {
		return s.store.GetChapter(ctx, targetChapterID)
	}
	chapters, err := s.store.ListChaptersByProject(ctx, projectID)
	if err != nil {
		return db.Chapter{}, err
	}
	for _, chapter := range chapters {
		if chapter.IsRoot {
			return chapter, nil
		}
	}
	return db.Chapter{}, sql.ErrNoRows
}

func (s *Server) chapterRepoAndHead(ctx context.Context, project db.Project, chapter db.Chapter) (string, string, error) {
	path := strings.TrimSpace(chapter.WorktreePath)
	if path == "" {
		path = strings.TrimSpace(project.GitPath)
	}
	if err := validateDir(path); err != nil {
		return "", "", err
	}
	repoRoot, _, err := runGitCommand(ctx, path, 4096, 3*time.Second, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", "", err
	}
	repoRoot = strings.TrimSpace(repoRoot)
	if !s.projectAllowsRepoRoot(project, repoRoot) && !pathWithin(chapter.WorktreePath, repoRoot) {
		return "", "", gitCommandError{Status: http.StatusForbidden, Msg: "git repository is outside the configured project boundary"}
	}
	head, _, err := runGitCommand(ctx, repoRoot, 256, 3*time.Second, nil, "rev-parse", "HEAD")
	if err != nil {
		return "", "", err
	}
	return repoRoot, strings.TrimSpace(head), nil
}

func (s *Server) projectAllowsRepoRoot(project db.Project, repoRoot string) bool {
	if strings.TrimSpace(project.GitPath) != "" && pathWithin(project.GitPath, repoRoot) {
		return true
	}
	if defaultDir := strings.TrimSpace(s.configSnapshot().Paths.DefaultProjectDir); defaultDir != "" && pathWithin(defaultDir, repoRoot) {
		return true
	}
	return false
}

func validateDir(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return gitCommandError{Status: http.StatusBadRequest, Msg: "path must be a directory"}
	}
	return nil
}

func currentGitRef(ctx context.Context, repoRoot string, chapter db.Chapter) (string, error) {
	if strings.TrimSpace(chapter.Branch) != "" {
		return strings.TrimSpace(chapter.Branch), nil
	}
	branch, _, _ := runGitCommand(ctx, repoRoot, 512, 2*time.Second, nil, "branch", "--show-current")
	if strings.TrimSpace(branch) != "" {
		return strings.TrimSpace(branch), nil
	}
	return "HEAD", nil
}

func validateGitBranchName(ctx context.Context, repoRoot, branch string) (string, error) {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: "branch is required"}
	}
	if strings.HasPrefix(branch, "-") || strings.Contains(branch, "..") || filepath.IsAbs(branch) {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: "invalid branch name"}
	}
	out, _, err := runGitCommand(ctx, repoRoot, 512, 3*time.Second, nil, "check-ref-format", "--branch", branch)
	if err != nil {
		return "", err
	}
	if normalized := strings.TrimSpace(out); normalized != "" {
		branch = normalized
	}
	return branch, nil
}

var branchUnsafeRE = regexp.MustCompile(`[^a-zA-Z0-9._/-]+`)

func defaultChapterBranch(title string) string {
	base := strings.ToLower(strings.TrimSpace(title))
	base = branchUnsafeRE.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-./")
	if base == "" {
		base = "chapter"
	}
	return "codeharbor/" + base + "-" + db.NewID()[:8]
}

func (s *Server) resolveForkWorktreePath(project db.Project, repoRoot, branch, requested string) (string, error) {
	base := s.chapterWorktreeBaseDir(project)
	var path string
	if strings.TrimSpace(requested) == "" {
		path = filepath.Join(base, slugify(branch))
	} else {
		abs, err := filepath.Abs(cleanProjectPath(strings.TrimSpace(requested)))
		if err != nil {
			return "", gitCommandError{Status: http.StatusBadRequest, Msg: err.Error()}
		}
		path = abs
	}
	if !pathWithin(base, path) {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: "worktree path must stay within the project worktree directory"}
	}
	if pathWithin(repoRoot, path) {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: "worktree path must not be inside the source repository"}
	}
	if _, err := os.Stat(path); err == nil {
		return "", gitCommandError{Status: http.StatusConflict, Msg: "worktree path already exists"}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	return path, nil
}

func (s *Server) chapterWorktreeBaseDir(project db.Project) string {
	projectPath := strings.TrimSpace(project.GitPath)
	defaultDir := strings.TrimSpace(s.configSnapshot().Paths.DefaultProjectDir)
	if defaultDir != "" && (projectPath == "" || pathWithin(defaultDir, projectPath)) {
		return filepath.Join(defaultDir, ".codeharbor-worktrees", slugify(project.Name))
	}
	if projectPath != "" {
		return filepath.Join(filepath.Dir(projectPath), ".codeharbor-worktrees", slugify(project.Name))
	}
	return filepath.Join(os.TempDir(), "codeharbor-worktrees", slugify(project.Name))
}

func removeGitWorktree(ctx context.Context, repoRoot, worktreePath string) error {
	_, _, err := runGitCommand(ctx, repoRoot, chapterGitOutputMaxBytes, 10*time.Second, []int{128}, "worktree", "remove", "--force", worktreePath)
	return err
}

func gitRepoDirty(ctx context.Context, repoRoot string) (bool, error) {
	statusOut, _, err := runGitCommand(ctx, repoRoot, gitStatusMaxBytes, 3*time.Second, nil, "status", "--porcelain=v1", "-z")
	if err != nil {
		return false, err
	}
	return strings.Trim(statusOut, "\x00\n\r\t ") != "", nil
}

func abortGitMerge(ctx context.Context, repoRoot string) error {
	_, _, err := runGitCommand(ctx, repoRoot, chapterGitOutputMaxBytes, 10*time.Second, []int{128}, "merge", "--abort")
	return err
}

func mergeCheckConflicts(ctx context.Context, tempDir string) []string {
	statusOut, _, err := runGitCommand(ctx, tempDir, gitStatusMaxBytes, 3*time.Second, nil, "status", "--porcelain=v1", "-z")
	if err != nil {
		return nil
	}
	files := parseGitPorcelainStatus(statusOut)
	conflicts := make([]string, 0)
	for _, file := range files {
		if isUnmergedStatus(file.Index, file.Worktree) {
			conflicts = append(conflicts, file.Path)
		}
	}
	return conflicts
}

func isUnmergedStatus(index, worktree string) bool {
	pair := index + worktree
	switch pair {
	case "DD", "AU", "UD", "UA", "DU", "AA", "UU":
		return true
	default:
		return false
	}
}

func writeChapterWorkflowError(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "chapter not found")
		return
	}
	writeGitError(w, err)
}
