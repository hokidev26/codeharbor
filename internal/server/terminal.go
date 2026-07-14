package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/creack/pty"
	"nhooyr.io/websocket"
)

type terminalMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func (s *Server) terminalWS(w http.ResponseWriter, r *http.Request) {
	if s.remoteHardeningActive(r) && !s.configSnapshot().Security.AllowRemoteTerminal {
		writeError(w, http.StatusForbidden, "remote terminal is disabled while remote access hardening is active")
		return
	}
	agentID := r.URL.Query().Get("agentId")
	if agentID == "" {
		writeError(w, http.StatusBadRequest, "agentId query parameter is required")
		return
	}
	if !s.requireAgentAccess(w, r, agentID) {
		return
	}
	agent, err := s.store.GetAgent(r.Context(), agentID)
	if err != nil {
		writeError(w, statusFromError(err), err.Error())
		return
	}
	if err := requireLocalExecutionAgent(agent); err != nil {
		writeExecutionGuardError(w, err)
		return
	}
	if !s.validateWebSocketRequest(w, r) {
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	cmd := exec.CommandContext(r.Context(), terminalShell())
	if agent.CWD != "" {
		cmd.Dir = agent.CWD
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 100, Rows: 28})
	if err != nil {
		writeTerminalJSON(r.Context(), conn, terminalMessage{Type: "error", Data: err.Error()})
		return
	}
	defer ptyFile.Close()
	defer func() { _ = cmd.Process.Kill() }()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go readPTY(ctx, conn, ptyFile, cancel)
	readTerminalInput(ctx, conn, ptyFile, cancel)
}

func terminalShell() string {
	if runtime.GOOS == "windows" {
		return "cmd"
	}
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		return shell
	}
	if _, err := os.Stat("/bin/zsh"); err == nil {
		return "/bin/zsh"
	}
	return "/bin/sh"
}

func readPTY(ctx context.Context, conn *websocket.Conn, reader io.Reader, cancel context.CancelFunc) {
	defer cancel()
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			if writeErr := writeTerminalJSON(ctx, conn, terminalMessage{Type: "output", Data: string(buf[:n])}); writeErr != nil {
				return
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				_ = writeTerminalJSON(ctx, conn, terminalMessage{Type: "error", Data: err.Error()})
			}
			return
		}
	}
}

func readTerminalInput(ctx context.Context, conn *websocket.Conn, writer *os.File, cancel context.CancelFunc) {
	defer cancel()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var msg terminalMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if msg.Data != "" {
				_, _ = writer.WriteString(msg.Data)
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				_ = pty.Setsize(writer, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
			}
		}
	}
}

func writeTerminalJSON(ctx context.Context, conn *websocket.Conn, msg terminalMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, data)
}
