package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveInCWDRejectsEscape(t *testing.T) {
	_, err := resolveInCWD(t.TempDir(), "../outside.txt")
	if err == nil {
		t.Fatal("expected escape error")
	}
}

func TestEditToolReplacesUniqueString(t *testing.T) {
	cwd := t.TempDir()
	if err := os.WriteFile(filepath.Join(cwd, "hello.txt"), []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(map[string]string{"file_path": "hello.txt", "old_string": "world", "new_string": "agent"})
	result, err := (EditTool{}).Execute(context.Background(), Call{ID: "e1", Name: "Edit", Input: input}, Env{CWD: cwd})
	if err != nil || result.IsError {
		t.Fatalf("edit failed: result=%+v err=%v", result, err)
	}
	data, err := os.ReadFile(filepath.Join(cwd, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello agent" {
		t.Fatalf("unexpected content: %q", string(data))
	}
}

func TestWriteThenRead(t *testing.T) {
	cwd := t.TempDir()
	writeInput, _ := json.Marshal(map[string]string{"file_path": "hello.txt", "content": "hello"})
	writeResult, err := (WriteTool{}).Execute(context.Background(), Call{ID: "w1", Name: "Write", Input: writeInput}, Env{CWD: cwd})
	if err != nil || writeResult.IsError {
		t.Fatalf("write failed: result=%+v err=%v", writeResult, err)
	}
	readInput, _ := json.Marshal(map[string]string{"file_path": filepath.Base("hello.txt")})
	readResult, err := (ReadTool{}).Execute(context.Background(), Call{ID: "r1", Name: "Read", Input: readInput}, Env{CWD: cwd})
	if err != nil || readResult.IsError {
		t.Fatalf("read failed: result=%+v err=%v", readResult, err)
	}
	if strings.TrimSpace(readResult.Output) != "hello" {
		t.Fatalf("expected hello, got %q", readResult.Output)
	}
}
