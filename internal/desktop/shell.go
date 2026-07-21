//go:build desktop

// Package desktop hosts the optional native shell that opens a WebView window
// against a running Autoto Runtime. Business APIs stay on HTTP/WebSocket so
// browsers and remote access continue to work unchanged.
//
// Build with -tags desktop so Linux CI and default go test ./... do not link Wails.
package desktop

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"autoto/internal/app"
	"autoto/internal/config"
)

// Options configures the desktop shell entry.
type Options struct {
	ConfigPath    string
	EphemeralHTTP bool
	ReadyTimeout  time.Duration
	Logger        *slog.Logger
	// Headless skips the native window and only prints the URL. Used when
	// native GUI libraries are unavailable (tests / CI fallback).
	Headless bool
	// DisableSingleInstance skips the single-instance lock (tests).
	DisableSingleInstance bool
}

// Run starts the Autoto runtime, waits until HTTP is healthy, opens a native
// window pointed at Runtime.URL(), and closes the runtime when the app quits
// or ctx is cancelled.
func Run(ctx context.Context, opts Options) error {
	if ctx == nil {
		ctx = context.Background()
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	if opts.ReadyTimeout <= 0 {
		opts.ReadyTimeout = 15 * time.Second
	}

	rt, err := app.NewRuntime(app.Options{
		ConfigPath:    opts.ConfigPath,
		EphemeralHTTP: opts.EphemeralHTTP,
		Logger:        logger,
	})
	if err != nil {
		return fmt.Errorf("create runtime: %w", err)
	}

	startCtx, cancelStart := context.WithTimeout(ctx, opts.ReadyTimeout)
	err = rt.Start(startCtx)
	cancelStart()
	if err != nil {
		_ = rt.Close(context.Background())
		return fmt.Errorf("start runtime: %w", err)
	}

	readyCtx, cancelReady := context.WithTimeout(ctx, opts.ReadyTimeout)
	err = rt.WaitReady(readyCtx)
	cancelReady()
	if err != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = rt.Close(shutdownCtx)
		cancel()
		return fmt.Errorf("wait ready: %w", err)
	}

	url := rt.URL()
	logger.Info("desktop runtime ready", "url", url, "version", config.Version)

	if opts.Headless {
		return runHeadless(ctx, rt, url, logger)
	}
	return runWailsShell(ctx, rt, url, logger, opts)
}

func runHeadless(ctx context.Context, rt *app.Runtime, url string, logger *slog.Logger) error {
	logger.Info("desktop headless mode: open the URL in a browser", "url", url)
	select {
	case <-ctx.Done():
	case <-rt.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := rt.Close(shutdownCtx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil && err != context.Canceled {
		return err
	}
	return nil
}

func runWailsShell(ctx context.Context, rt *app.Runtime, url string, logger *slog.Logger, opts Options) error {
	var (
		closeErr error
		closeMu  sync.Mutex
		closed   bool
		mainWin  *application.WebviewWindow
	)
	closeRuntime := func() {
		closeMu.Lock()
		defer closeMu.Unlock()
		if closed {
			return
		}
		closed = true
		// Clear shell hosts so late HTTP calls cannot open dialogs / stage updates.
		rt.SetShellDialogHost(nil)
		rt.SetShellLifecycleHost(nil)
		rt.SetShellUpdateHost(nil)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := rt.Close(shutdownCtx); err != nil {
			closeErr = err
			logger.Error("desktop runtime shutdown", "error", err)
		}
	}

	appOptions := application.Options{
		Name:        "Autoto",
		Description: "Local-first coding agent (desktop shell)",
		Logger:      logger,
		OnShutdown:  closeRuntime,
		Mac: application.MacOptions{
			// Tray keeps the process alive when the main window is hidden.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	}
	if len(appIconPNG) > 0 {
		appOptions.Icon = appIconPNG
	}
	if !opts.DisableSingleInstance {
		appOptions.SingleInstance = &application.SingleInstanceOptions{
			UniqueID: "com.autoto.desktop",
			// Fixed key only for inter-process second-instance handoff; not a
			// product secret. Zero key would also work but Wails examples use one.
			EncryptionKey: [32]byte{
				0xa7, 0x70, 0x74, 0x6f, 0x2d, 0x64, 0x65, 0x73,
				0x6b, 0x74, 0x6f, 0x70, 0x2d, 0x73, 0x68, 0x65,
				0x6c, 0x6c, 0x2d, 0x73, 0x69, 0x6e, 0x67, 0x6c,
				0x65, 0x2d, 0x69, 0x6e, 0x73, 0x74, 0x31, 0x21,
			},
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				logger.Info("second desktop instance redirected", "args", data.Args)
				if raw, ok := FindDeepLinkInArgs(data.Args); ok {
					// lifeHost may be nil until after application.New wiring; use mainWin focus always.
					if mainWin != nil {
						mainWin.Restore()
						mainWin.Show()
						mainWin.Focus()
					}
					// Best-effort: navigate after hosts attach (window JS).
					if link, ok := ParseDeepLink(raw); ok && mainWin != nil {
						js := fmt.Sprintf(`(function(){try{var t=%q;var i=t.indexOf('#');if(i>=0)location.hash=t.slice(i+1);window.dispatchEvent(new CustomEvent('autoto:deeplink',{detail:%q}));}catch(e){}})();`, link.Target, link.Raw)
						mainWin.ExecJS(js)
					}
					return
				}
				if mainWin != nil {
					mainWin.Restore()
					mainWin.Show()
					mainWin.Focus()
				}
			},
		}
	}

	wailsApp := application.New(appOptions)
	dialogHost := NewWailsDialogHost(wailsApp)
	lifeHost := newLifecycleHost(wailsApp, logger)
	homeDir := rt.Config().Paths.HomeDir
	updHost := newUpdateHost(homeDir, logger)
	rt.SetShellDialogHost(dialogHost)
	rt.SetShellLifecycleHost(lifeHost)
	rt.SetShellUpdateHost(updHost)

	statePath := windowStatePath(homeDir)
	savedState, hasSavedState := loadWindowState(statePath)
	width, height := 1280, 840
	if hasSavedState {
		width, height = savedState.Width, savedState.Height
	}

	mainWin = wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "Autoto",
		Width:     width,
		Height:    height,
		MinWidth:  900,
		MinHeight: 600,
		URL:       url,
		// Marker for frontend platform adapters (native dialogs via HTTP bridge).
		JS: "window.AUTOTO_DESKTOP_SHELL=true;",
	})
	dialogHost.AttachWindow(mainWin)
	lifeHost.AttachWindow(mainWin)
	attachSystemTray(wailsApp, mainWin, logger, lifeHost)
	attachDeepLinkHandlers(wailsApp, lifeHost, logger)
	if hasSavedState {
		applyWindowState(mainWin, savedState)
	} else {
		mainWin.Center()
	}
	attachWindowStatePersistence(mainWin, statePath, logger)
	mainWin.Show()

	// If the HTTP server dies or the parent context is cancelled, quit the shell.
	go func() {
		select {
		case <-rt.Done():
			logger.Info("runtime requested shutdown; quitting desktop shell")
		case <-ctx.Done():
			logger.Info("desktop context cancelled; quitting desktop shell")
		}
		wailsApp.Quit()
	}()

	if err := wailsApp.Run(); err != nil {
		closeRuntime()
		closeMu.Lock()
		defer closeMu.Unlock()
		if closeErr != nil {
			return fmt.Errorf("wails run: %w; runtime close: %v", err, closeErr)
		}
		return fmt.Errorf("wails run: %w", err)
	}
	closeRuntime()
	closeMu.Lock()
	defer closeMu.Unlock()
	return closeErr
}
