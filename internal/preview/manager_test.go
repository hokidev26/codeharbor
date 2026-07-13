package preview

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimepkg "autoto/internal/runtime"
)

var _ runtimepkg.Service = (*Manager)(nil)

func TestStaticPreviewStartIsIdempotentAndStops(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "index.html"), "<h1>preview</h1>")
	profile := mustProfileByKind(t, root, KindStatic)
	manager := NewManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	reserved, err := reserveLoopbackPort(nil)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.StartPreview(context.Background(), "agent-1", root, StartOptions{ProfileID: profile.ID, Port: &reserved})
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != StateReady || !status.Running || status.Port != reserved || status.ProfileID != profile.ID {
		t.Fatalf("unexpected ready status: %+v", status)
	}
	response, err := http.Get(status.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "preview") {
		t.Fatalf("unexpected static response: status=%d body=%q", response.StatusCode, body)
	}

	again, err := manager.StartPreview(context.Background(), "agent-1", root, StartOptions{ProfileID: profile.ID})
	if err != nil {
		t.Fatal(err)
	}
	if again.URL != status.URL || again.Port != status.Port || again.Status != StateReady {
		t.Fatalf("same profile start must be idempotent: first=%+v again=%+v", status, again)
	}

	stopped, err := manager.StopPreview(context.Background(), "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != StateStopped || stopped.Running || stopped.Port != 0 || stopped.URL != "" {
		t.Fatalf("unexpected stopped status: %+v", stopped)
	}
	client := &http.Client{Timeout: 300 * time.Millisecond}
	if _, err := client.Get(status.URL); err == nil {
		t.Fatal("expected stopped static server to reject connections")
	}
}

func TestStartingDifferentProfileStopsPreviousPreview(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "index.html"), "root")
	writeTestFile(t, filepath.Join(root, "apps", "other", "index.html"), "other")
	profiles, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 2 {
		t.Fatalf("expected two static profiles, got %+v", profiles)
	}
	manager := NewManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	firstPort, err := reserveLoopbackPort(nil)
	if err != nil {
		t.Fatal(err)
	}
	secondPort, err := reserveLoopbackPort(nil)
	if err != nil {
		t.Fatal(err)
	}
	for secondPort == firstPort {
		secondPort, err = reserveLoopbackPort(nil)
		if err != nil {
			t.Fatal(err)
		}
	}

	first, err := manager.StartPreview(context.Background(), "agent-1", root, StartOptions{ProfileID: profiles[0].ID, Port: &firstPort})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.StartPreview(context.Background(), "agent-1", root, StartOptions{ProfileID: profiles[1].ID, Port: &secondPort})
	if err != nil {
		t.Fatal(err)
	}
	if second.ProfileID != profiles[1].ID || second.Status != StateReady {
		t.Fatalf("unexpected replacement status: %+v", second)
	}
	if first.URL == second.URL {
		t.Fatal("replacement preview unexpectedly reused the same listener")
	}
	client := &http.Client{Timeout: 300 * time.Millisecond}
	if _, err := client.Get(first.URL); err == nil {
		t.Fatal("previous preview remained reachable after replacement")
	}
}

func TestStaticHandlerRejectsSensitiveAndEscapingSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	writeTestFile(t, filepath.Join(root, "index.html"), "ok")
	writeTestFile(t, filepath.Join(root, ".env"), "TOKEN=secret")
	writeTestFile(t, filepath.Join(outside, "secret.txt"), "outside")
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "leak.txt")); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}

	handler := newStaticHandler(root, root)
	for _, requestPath := range []string{"/.env", "/leak.txt", "/../secret.txt"} {
		request := httptest.NewRequest(http.MethodGet, "http://preview.invalid/", nil)
		request.URL.Path = requestPath
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected %q to be hidden, got %d: %s", requestPath, recorder.Code, recorder.Body.String())
		}
	}
}

func TestStartRejectsStaleFingerprint(t *testing.T) {
	root := t.TempDir()
	indexPath := filepath.Join(root, "index.html")
	writeTestFile(t, indexPath, "before")
	profile := mustProfileByKind(t, root, KindStatic)
	writeTestFile(t, indexPath, "after")

	manager := NewManager()
	status, err := manager.StartPreview(context.Background(), "agent-1", root, StartOptions{ProfileID: profile.ID})
	if !errors.Is(err, ErrStaleProfile) {
		t.Fatalf("expected stale profile error, got status=%+v err=%v", status, err)
	}
	if status.Running || status.Status != StateStopped {
		t.Fatalf("stale profile must not start: %+v", status)
	}
}

func TestManagerCloseStopsAllPreviews(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "index.html"), "close")
	profile := mustProfileByKind(t, root, KindStatic)
	manager := NewManager()
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}

	urls := make([]string, 0, 2)
	for _, agentID := range []string{"agent-1", "agent-2"} {
		status, err := manager.StartPreview(context.Background(), agentID, root, StartOptions{ProfileID: profile.ID})
		if err != nil {
			t.Fatal(err)
		}
		urls = append(urls, status.URL)
	}
	closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := manager.Close(closeCtx); err != nil {
		t.Fatal(err)
	}
	for index, agentID := range []string{"agent-1", "agent-2"} {
		status := manager.Status(agentID)
		if status.Status != StateStopped || status.Running {
			t.Fatalf("preview %s was not stopped: %+v", agentID, status)
		}
		client := &http.Client{Timeout: 300 * time.Millisecond}
		if _, err := client.Get(urls[index]); err == nil {
			t.Fatalf("preview %s remained reachable after manager close", agentID)
		}
	}
	if _, err := manager.Detect(root); !errors.Is(err, ErrManagerClosed) {
		t.Fatalf("closed manager must reject new work, got %v", err)
	}
	if err := manager.Close(context.Background()); err != nil {
		t.Fatalf("repeated close must be safe: %v", err)
	}
}

func TestLogRingBoundsAndTruncatesOutput(t *testing.T) {
	ring := &logRing{}
	writer := &lineWriter{stream: "stderr", ring: ring}
	longLine := strings.Repeat("x", maxLogLineBytes*2)
	if _, err := writer.Write([]byte(longLine + "\n")); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 1200; index++ {
		ring.add("stdout", strconv.Itoa(index))
	}

	logs := ring.snapshot()
	if len(logs.Lines) > maxAPILogLines {
		t.Fatalf("API returned too many lines: %d", len(logs.Lines))
	}
	bytes := 0
	for _, line := range logs.Lines {
		bytes += len(line.Stream) + len(line.Line)
	}
	if bytes > maxAPILogBytes {
		t.Fatalf("API returned too many log bytes: %d", bytes)
	}

	truncationRing := &logRing{}
	truncationWriter := &lineWriter{stream: "stderr", ring: truncationRing}
	_, _ = truncationWriter.Write([]byte(longLine + "\n"))
	truncated := truncationRing.snapshot()
	if len(truncated.Lines) != 1 || len(truncated.Lines[0].Line) > maxLogLineBytes || !strings.HasSuffix(truncated.Lines[0].Line, truncatedLogLabel) {
		t.Fatalf("long line was not safely truncated: %+v", truncated.Lines)
	}
}
