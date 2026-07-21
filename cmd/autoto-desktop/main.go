//go:build desktop

// Command autoto-desktop opens a native Wails WebView against a live Autoto
// Runtime. The browser CLI entrypoint (cmd/autoto) and remote access remain
// fully supported; this process is an optional local client.
//
// Build (requires native WebView / Wails deps):
//
//	go build -tags desktop -o autoto-desktop ./cmd/autoto-desktop
//
// Architecture:
//
//	app.Runtime (HTTP/WebSocket/Agent)
//	  └── Wails window loads Runtime.URL()
//
// Closing the window shuts down this Runtime instance. Long-lived remote
// servers should continue to use `autoto` / `cmd/autoto`, not this GUI shell.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"autoto/internal/desktop"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	flags := flag.NewFlagSet("autoto-desktop", flag.ContinueOnError)
	configPath := flags.String("config", "", "path to config.json")
	// Default true: desktop must not steal the standard CLI/browser port.
	ephemeral := flags.Bool("ephemeral-http", true, "bind HTTP on 127.0.0.1:0 to avoid clashing with CLI/browser instances")
	readyTimeout := flags.Duration("ready-timeout", 15*time.Second, "how long to wait for /api/health")
	headless := flags.Bool("headless", false, "skip native window; print URL and wait (CI / fallback)")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	err := desktop.Run(ctx, desktop.Options{
		ConfigPath:    *configPath,
		EphemeralHTTP: *ephemeral,
		ReadyTimeout:  *readyTimeout,
		Logger:        logger,
		Headless:      *headless,
	})
	if err != nil {
		logger.Error("desktop shell failed", "error", err)
		return 1
	}
	return 0
}
