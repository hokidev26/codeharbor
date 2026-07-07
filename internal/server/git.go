package server

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

const (
	gitStatusMaxBytes        = 1 << 20
	gitDiffMaxBytes          = 2 << 20
	gitLogMaxBytes           = 512 << 10
	gitCommitOutputMaxBytes  = 512 << 10
	gitCommitMessageMaxBytes = 10 << 10
	gitCommitMaxPaths        = 200
)

type gitStatusResponse struct {
	GeneratedAt string          `json:"generatedAt"`
	CWD         string          `json:"cwd"`
	RepoRoot    string          `json:"repoRoot"`
	Head        string          `json:"head,omitempty"`
	Branch      string          `json:"branch,omitempty"`
	Upstream    string          `json:"upstream,omitempty"`
	Ahead       int             `json:"ahead,omitempty"`
	Behind      int             `json:"behind,omitempty"`
	Clean       bool            `json:"clean"`
	Files       []gitStatusFile `json:"files"`
	Truncated   bool            `json:"truncated,omitempty"`
}

type gitStatusFile struct {
	Path      string `json:"path"`
	OrigPath  string `json:"origPath,omitempty"`
	Index     string `json:"index"`
	Worktree  string `json:"worktree"`
	Staged    bool   `json:"staged"`
	Unstaged  bool   `json:"unstaged"`
	Untracked bool   `json:"untracked"`
	Renamed   bool   `json:"renamed"`
}

type gitDiffResponse struct {
	GeneratedAt string        `json:"generatedAt"`
	RepoRoot    string        `json:"repoRoot"`
	Scope       string        `json:"scope"`
	Path        string        `json:"path,omitempty"`
	Patch       string        `json:"patch"`
	Files       []gitDiffFile `json:"files"`
	Truncated   bool          `json:"truncated,omitempty"`
}

type gitDiffFile struct {
	Path    string `json:"path"`
	OldPath string `json:"oldPath,omitempty"`
	Added   int    `json:"added"`
	Deleted int    `json:"deleted"`
	Binary  bool   `json:"binary,omitempty"`
}

type gitLogResponse struct {
	GeneratedAt string      `json:"generatedAt"`
	RepoRoot    string      `json:"repoRoot"`
	Commits     []gitCommit `json:"commits"`
	Truncated   bool        `json:"truncated,omitempty"`
}

type gitCommitRequest struct {
	Message string   `json:"message"`
	Paths   []string `json:"paths"`
}

type gitCommitResponse struct {
	GeneratedAt    string          `json:"generatedAt"`
	RepoRoot       string          `json:"repoRoot"`
	Commit         gitCommit       `json:"commit"`
	Paths          []string        `json:"paths"`
	RemainingFiles []gitStatusFile `json:"remainingFiles"`
	Truncated      bool            `json:"truncated,omitempty"`
}

type gitCommit struct {
	Hash        string `json:"hash"`
	ShortHash   string `json:"shortHash"`
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
	Date        string `json:"date"`
	Subject     string `json:"subject"`
}

type gitCommandError struct {
	Status int
	Msg    string
}

func (e gitCommandError) Error() string { return e.Msg }

func (s *Server) gitStatus(w http.ResponseWriter, r *http.Request) {
	cwd, repoRoot, err := s.resolveNarratorGitRepo(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeGitError(w, err)
		return
	}
	statusOut, truncated, err := runGitCommand(r.Context(), repoRoot, gitStatusMaxBytes, 3*time.Second, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		writeGitError(w, err)
		return
	}
	files := parseGitPorcelainStatus(statusOut)
	head, _, _ := runGitCommand(r.Context(), repoRoot, 256, 2*time.Second, nil, "rev-parse", "--short", "HEAD")
	branch, _, _ := runGitCommand(r.Context(), repoRoot, 512, 2*time.Second, nil, "branch", "--show-current")
	upstream, _, _ := runGitCommand(r.Context(), repoRoot, 512, 2*time.Second, nil, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	ahead, behind := 0, 0
	if strings.TrimSpace(upstream) != "" {
		counts, _, err := runGitCommand(r.Context(), repoRoot, 128, 2*time.Second, nil, "rev-list", "--left-right", "--count", "HEAD...@{u}")
		if err == nil {
			ahead, behind = parseAheadBehind(counts)
		}
	}
	writeJSON(w, http.StatusOK, gitStatusResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		CWD:         cwd,
		RepoRoot:    repoRoot,
		Head:        strings.TrimSpace(head),
		Branch:      strings.TrimSpace(branch),
		Upstream:    strings.TrimSpace(upstream),
		Ahead:       ahead,
		Behind:      behind,
		Clean:       len(files) == 0,
		Files:       files,
		Truncated:   truncated,
	})
}

func (s *Server) gitDiff(w http.ResponseWriter, r *http.Request) {
	_, repoRoot, err := s.resolveNarratorGitRepo(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeGitError(w, err)
		return
	}
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "staged" && scope != "unstaged" {
		writeError(w, http.StatusBadRequest, "invalid git diff scope")
		return
	}
	relPath, err := cleanGitPath(repoRoot, r.URL.Query().Get("path"))
	if err != nil {
		writeGitError(w, err)
		return
	}
	contextLines := boundedInt(r.URL.Query().Get("context"), 3, 0, 20)
	patchArgs := gitDiffArgs(scope, contextLines, false, relPath)
	patch, truncated, err := runGitCommand(r.Context(), repoRoot, gitDiffMaxBytes, 5*time.Second, nil, patchArgs...)
	if err != nil {
		writeGitError(w, err)
		return
	}
	statArgs := gitDiffArgs(scope, contextLines, true, relPath)
	statOut, statTruncated, _ := runGitCommand(r.Context(), repoRoot, gitLogMaxBytes, 5*time.Second, nil, statArgs...)
	writeJSON(w, http.StatusOK, gitDiffResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		RepoRoot:    repoRoot,
		Scope:       scope,
		Path:        relPath,
		Patch:       safeUTF8(patch),
		Files:       parseGitNumstat(statOut),
		Truncated:   truncated || statTruncated,
	})
}

func (s *Server) gitLog(w http.ResponseWriter, r *http.Request) {
	_, repoRoot, err := s.resolveNarratorGitRepo(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeGitError(w, err)
		return
	}
	limit := boundedInt(r.URL.Query().Get("limit"), 30, 1, 100)
	format := "%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%x1e"
	out, truncated, err := runGitCommand(r.Context(), repoRoot, gitLogMaxBytes, 3*time.Second, nil, "log", "--max-count="+strconv.Itoa(limit), "--date=iso-strict", "--pretty=format:"+format)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gitLogResponse{GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano), RepoRoot: repoRoot, Commits: parseGitLog(out), Truncated: truncated})
}

func (s *Server) gitCommit(w http.ResponseWriter, r *http.Request) {
	_, repoRoot, err := s.resolveNarratorGitRepo(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeGitError(w, err)
		return
	}
	var req gitCommitRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		writeError(w, http.StatusBadRequest, "commit message is required")
		return
	}
	if len(message) > gitCommitMessageMaxBytes {
		writeError(w, http.StatusBadRequest, "commit message is too long")
		return
	}
	paths, err := cleanGitCommitPaths(repoRoot, req.Paths)
	if err != nil {
		writeGitError(w, err)
		return
	}
	for _, path := range paths {
		if isSensitiveGitPath(path) {
			writeError(w, http.StatusBadRequest, "refusing to commit sensitive-looking path: "+path)
			return
		}
	}
	statusOut, _, err := runGitCommand(r.Context(), repoRoot, gitStatusMaxBytes, 3*time.Second, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		writeGitError(w, err)
		return
	}
	statusFiles := parseGitPorcelainStatus(statusOut)
	if err := validateGitCommitSelection(statusFiles, paths); err != nil {
		writeGitError(w, err)
		return
	}
	commitPaths := expandGitCommitPaths(statusFiles, paths)
	for _, path := range commitPaths {
		if isSensitiveGitPath(path) {
			writeError(w, http.StatusBadRequest, "refusing to commit sensitive-looking path: "+path)
			return
		}
	}
	addArgs := append([]string{"add", "--"}, commitPaths...)
	if _, _, err := runGitCommand(r.Context(), repoRoot, gitCommitOutputMaxBytes, 10*time.Second, nil, addArgs...); err != nil {
		writeGitError(w, err)
		return
	}
	diffArgs := append([]string{"diff", "--cached", "--name-only", "-z", "--"}, commitPaths...)
	stagedOut, _, err := runGitCommand(r.Context(), repoRoot, gitCommitOutputMaxBytes, 5*time.Second, nil, diffArgs...)
	if err != nil {
		writeGitError(w, err)
		return
	}
	stagedPaths := parseGitPathList(stagedOut)
	if len(stagedPaths) == 0 {
		writeGitError(w, gitCommandError{Status: http.StatusConflict, Msg: "no staged changes for selected paths"})
		return
	}
	commitArgs := append([]string{"commit", "-m", message, "--"}, commitPaths...)
	if _, _, err := runGitCommand(r.Context(), repoRoot, gitCommitOutputMaxBytes, 20*time.Second, nil, commitArgs...); err != nil {
		writeGitError(w, normalizeGitCommitError(err))
		return
	}
	format := "%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%x1e"
	logOut, logTruncated, err := runGitCommand(r.Context(), repoRoot, gitLogMaxBytes, 3*time.Second, nil, "log", "-1", "--date=iso-strict", "--pretty=format:"+format)
	if err != nil {
		writeGitError(w, err)
		return
	}
	commits := parseGitLog(logOut)
	if len(commits) == 0 {
		writeGitError(w, gitCommandError{Status: http.StatusInternalServerError, Msg: "commit succeeded but new commit could not be read"})
		return
	}
	remainingOut, remainingTruncated, _ := runGitCommand(r.Context(), repoRoot, gitStatusMaxBytes, 3*time.Second, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	writeJSON(w, http.StatusCreated, gitCommitResponse{
		GeneratedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		RepoRoot:       repoRoot,
		Commit:         commits[0],
		Paths:          paths,
		RemainingFiles: parseGitPorcelainStatus(remainingOut),
		Truncated:      logTruncated || remainingTruncated,
	})
}

func (s *Server) resolveNarratorGitRepo(ctx context.Context, narratorID string) (string, string, error) {
	narrator, err := s.store.GetNarrator(ctx, narratorID)
	if err != nil {
		return "", "", err
	}
	cwd := strings.TrimSpace(narrator.CWD)
	if cwd == "" && narrator.ChapterID != "" {
		chapter, err := s.store.GetChapter(ctx, narrator.ChapterID)
		if err == nil {
			cwd = strings.TrimSpace(chapter.WorktreePath)
		}
	}
	if cwd == "" {
		return "", "", gitCommandError{Status: http.StatusBadRequest, Msg: "narrator cwd is not configured"}
	}
	info, err := os.Stat(cwd)
	if err != nil {
		return "", "", err
	}
	if !info.IsDir() {
		return "", "", gitCommandError{Status: http.StatusBadRequest, Msg: "narrator cwd must be a directory"}
	}
	repoRoot, _, err := runGitCommand(ctx, cwd, 4096, 3*time.Second, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", "", err
	}
	return cwd, strings.TrimSpace(repoRoot), nil
}

func cleanGitCommitPaths(repoRoot string, rawPaths []string) ([]string, error) {
	if len(rawPaths) == 0 {
		return nil, gitCommandError{Status: http.StatusBadRequest, Msg: "at least one git path is required"}
	}
	if len(rawPaths) > gitCommitMaxPaths {
		return nil, gitCommandError{Status: http.StatusBadRequest, Msg: "too many git paths selected"}
	}
	paths := make([]string, 0, len(rawPaths))
	seen := make(map[string]bool, len(rawPaths))
	for _, rawPath := range rawPaths {
		relPath, err := cleanGitPath(repoRoot, rawPath)
		if err != nil {
			return nil, err
		}
		if relPath == "" {
			return nil, gitCommandError{Status: http.StatusBadRequest, Msg: "git path is required"}
		}
		if seen[relPath] {
			continue
		}
		seen[relPath] = true
		paths = append(paths, relPath)
	}
	if len(paths) == 0 {
		return nil, gitCommandError{Status: http.StatusBadRequest, Msg: "at least one git path is required"}
	}
	return paths, nil
}

func validateGitCommitSelection(files []gitStatusFile, paths []string) error {
	matched := make(map[string]bool, len(paths))
	for _, file := range files {
		selected := false
		for _, path := range paths {
			if gitStatusFileMatchesPath(file, path) {
				matched[path] = true
				selected = true
			}
		}
		if file.Staged && !selected {
			return gitCommandError{Status: http.StatusConflict, Msg: "staged changes outside selected paths must be committed separately: " + file.Path}
		}
	}
	for _, path := range paths {
		if !matched[path] {
			return gitCommandError{Status: http.StatusConflict, Msg: "selected path has no worktree changes: " + path}
		}
	}
	return nil
}

func expandGitCommitPaths(files []gitStatusFile, paths []string) []string {
	expanded := make([]string, 0, len(paths))
	seen := make(map[string]bool, len(paths)*2)
	appendPath := func(path string) {
		path = filepath.ToSlash(strings.TrimSpace(path))
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		expanded = append(expanded, path)
	}
	for _, path := range paths {
		appendPath(path)
	}
	for _, file := range files {
		if file.OrigPath == "" || !gitStatusFileSelected(file, paths) {
			continue
		}
		appendPath(file.OrigPath)
		appendPath(file.Path)
	}
	return expanded
}

func gitStatusFileSelected(file gitStatusFile, paths []string) bool {
	for _, path := range paths {
		if gitStatusFileMatchesPath(file, path) {
			return true
		}
	}
	return false
}

func gitStatusFileMatchesPath(file gitStatusFile, path string) bool {
	return gitPathMatchesSelection(file.Path, path) || (file.OrigPath != "" && gitPathMatchesSelection(file.OrigPath, path))
}

func gitPathMatchesSelection(filePath, selectedPath string) bool {
	filePath = filepath.ToSlash(strings.TrimSpace(filePath))
	selectedPath = strings.TrimSuffix(filepath.ToSlash(strings.TrimSpace(selectedPath)), "/")
	return filePath == selectedPath || strings.HasPrefix(filePath, selectedPath+"/")
}

func parseGitPathList(out string) []string {
	parts := strings.Split(out, "\x00")
	paths := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		paths = append(paths, filepath.ToSlash(part))
	}
	return paths
}

func isSensitiveGitPath(path string) bool {
	base := strings.ToLower(filepath.Base(filepath.ToSlash(path)))
	if base == "" || base == "." {
		return false
	}
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return !hasAnySuffix(base, ".example", ".sample", ".template", ".dist")
	}
	sensitiveNames := map[string]bool{
		".netrc":                 true,
		".npmrc":                 true,
		".pypirc":                true,
		"credentials.json":       true,
		"client_secret.json":     true,
		"secret.json":            true,
		"secrets.json":           true,
		"id_rsa":                 true,
		"id_dsa":                 true,
		"id_ecdsa":               true,
		"id_ed25519":             true,
		"known_hosts.old":        true,
		"service-account.json":   true,
		"service_account.json":   true,
		"firebase-adminsdk.json": true,
	}
	if sensitiveNames[base] {
		return true
	}
	if strings.HasPrefix(base, "service-account") && strings.HasSuffix(base, ".json") {
		return true
	}
	if strings.HasPrefix(base, "service_account") && strings.HasSuffix(base, ".json") {
		return true
	}
	if strings.HasSuffix(base, "-credentials.json") || strings.HasSuffix(base, "_credentials.json") {
		return true
	}
	switch filepath.Ext(base) {
	case ".key", ".pem", ".p12", ".pfx":
		return true
	}
	return false
}

func hasAnySuffix(value string, suffixes ...string) bool {
	for _, suffix := range suffixes {
		if strings.HasSuffix(value, suffix) {
			return true
		}
	}
	return false
}

func normalizeGitCommitError(err error) error {
	var gitErr gitCommandError
	if !errors.As(err, &gitErr) {
		return err
	}
	lower := strings.ToLower(gitErr.Msg)
	if strings.Contains(lower, "nothing to commit") || strings.Contains(lower, "no changes added to commit") || strings.Contains(lower, "no changes added") {
		gitErr.Status = http.StatusConflict
	}
	return gitErr
}

func gitDiffArgs(scope string, contextLines int, numstat bool, relPath string) []string {
	args := []string{"diff", "--no-ext-diff", "--find-renames"}
	if numstat {
		args = append(args, "--numstat", "-z")
	} else {
		args = append(args, "--unified="+strconv.Itoa(contextLines))
	}
	switch scope {
	case "all":
		args = append(args, "HEAD")
	case "staged":
		args = append(args, "--cached")
	}
	args = append(args, "--")
	if relPath != "" {
		args = append(args, relPath)
	}
	return args
}

func cleanGitPath(repoRoot, input string) (string, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", nil
	}
	var abs string
	if filepath.IsAbs(trimmed) {
		abs = filepath.Clean(trimmed)
	} else {
		cleaned := filepath.Clean(trimmed)
		if cleaned == "." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) || cleaned == ".." {
			return "", gitCommandError{Status: http.StatusBadRequest, Msg: "git path escapes repository"}
		}
		abs = filepath.Join(repoRoot, cleaned)
	}
	rel, err := filepath.Rel(repoRoot, abs)
	if err != nil {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: err.Error()}
	}
	if rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." || filepath.IsAbs(rel) {
		return "", gitCommandError{Status: http.StatusBadRequest, Msg: "git path escapes repository"}
	}
	return filepath.ToSlash(rel), nil
}

type limitedBuffer struct {
	buf       bytes.Buffer
	max       int
	truncated bool
}

func (w *limitedBuffer) Write(p []byte) (int, error) {
	if w.max <= 0 {
		return len(p), nil
	}
	remaining := w.max - w.buf.Len()
	if remaining > 0 {
		if len(p) <= remaining {
			_, _ = w.buf.Write(p)
		} else {
			_, _ = w.buf.Write(p[:remaining])
			w.truncated = true
		}
	} else if len(p) > 0 {
		w.truncated = true
	}
	return len(p), nil
}

func runGitCommand(parent context.Context, dir string, maxBytes int, timeout time.Duration, allowedExitCodes []int, args ...string) (string, bool, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "GIT_EXTERNAL_DIFF=")
	stdout := &limitedBuffer{max: maxBytes}
	stderr := &limitedBuffer{max: 64 << 10}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return stdout.buf.String(), stdout.truncated, gitCommandError{Status: http.StatusGatewayTimeout, Msg: "git command timed out"}
	}
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", false, gitCommandError{Status: http.StatusServiceUnavailable, Msg: "git executable not found"}
		}
		exitCode := -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
			for _, allowed := range allowedExitCodes {
				if exitCode == allowed {
					return stdout.buf.String(), stdout.truncated, nil
				}
			}
		}
		msg := strings.TrimSpace(stderr.buf.String())
		if msg == "" {
			msg = err.Error()
		}
		status := http.StatusInternalServerError
		lower := strings.ToLower(msg)
		if strings.Contains(lower, "not a git repository") || strings.Contains(lower, "not a git repo") {
			status = http.StatusConflict
		}
		if strings.Contains(lower, "unknown revision") || strings.Contains(lower, "ambiguous argument") || strings.Contains(lower, "bad revision") {
			status = http.StatusBadRequest
		}
		return stdout.buf.String(), stdout.truncated, gitCommandError{Status: status, Msg: msg}
	}
	return stdout.buf.String(), stdout.truncated, nil
}

func parseGitPorcelainStatus(out string) []gitStatusFile {
	parts := strings.Split(out, "\x00")
	files := make([]gitStatusFile, 0, len(parts))
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if len(entry) < 4 {
			continue
		}
		index := string(entry[0])
		worktree := string(entry[1])
		path := entry[3:]
		file := gitStatusFile{Path: filepath.ToSlash(path), Index: index, Worktree: worktree}
		file.Untracked = index == "?" && worktree == "?"
		file.Staged = index != " " && index != "?"
		file.Unstaged = worktree != " " && worktree != "?"
		file.Renamed = index == "R" || worktree == "R" || index == "C" || worktree == "C"
		if file.Renamed && i+1 < len(parts) && parts[i+1] != "" {
			file.OrigPath = filepath.ToSlash(parts[i+1])
			i++
		}
		files = append(files, file)
	}
	return files
}

func parseAheadBehind(out string) (int, int) {
	fields := strings.Fields(out)
	if len(fields) < 2 {
		return 0, 0
	}
	ahead, _ := strconv.Atoi(fields[0])
	behind, _ := strconv.Atoi(fields[1])
	return ahead, behind
}

func parseGitNumstat(out string) []gitDiffFile {
	records := strings.Split(out, "\x00")
	files := make([]gitDiffFile, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record) == "" {
			continue
		}
		fields := strings.Split(record, "\t")
		if len(fields) < 3 {
			continue
		}
		added, binaryA := parseNumstatCount(fields[0])
		deleted, binaryD := parseNumstatCount(fields[1])
		files = append(files, gitDiffFile{Path: filepath.ToSlash(fields[2]), Added: added, Deleted: deleted, Binary: binaryA || binaryD})
	}
	return files
}

func parseNumstatCount(value string) (int, bool) {
	if value == "-" {
		return 0, true
	}
	parsed, _ := strconv.Atoi(value)
	return parsed, false
}

func parseGitLog(out string) []gitCommit {
	records := strings.Split(out, "\x1e")
	commits := make([]gitCommit, 0, len(records))
	for _, record := range records {
		record = strings.Trim(record, "\x00\n\r ")
		if record == "" {
			continue
		}
		fields := strings.Split(record, "\x00")
		if len(fields) < 6 {
			continue
		}
		commits = append(commits, gitCommit{Hash: fields[0], ShortHash: fields[1], AuthorName: fields[2], AuthorEmail: fields[3], Date: fields[4], Subject: fields[5]})
	}
	return commits
}

func boundedInt(raw string, fallback, minValue, maxValue int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		value = fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func safeUTF8(text string) string {
	if utf8.ValidString(text) {
		return text
	}
	return strings.ToValidUTF8(text, "�")
}

func writeGitError(w http.ResponseWriter, err error) {
	var gitErr gitCommandError
	if errors.As(err, &gitErr) {
		writeError(w, gitErr.Status, gitErr.Msg)
		return
	}
	writeError(w, statusFromError(err), err.Error())
}
