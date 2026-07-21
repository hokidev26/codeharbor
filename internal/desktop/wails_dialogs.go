//go:build desktop

package desktop

import (
	"context"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"autoto/internal/server"
)

// WailsDialogHost shows OS-native dialogs through Wails.
// Methods are safe to call from HTTP handlers (they hop onto the UI thread).
type WailsDialogHost struct {
	app    *application.App
	window *application.WebviewWindow
	mu     sync.RWMutex
}

// NewWailsDialogHost creates a host bound to a Wails application. Window may be
// set later with AttachWindow so dialogs can be sheet-attached on macOS.
func NewWailsDialogHost(app *application.App) *WailsDialogHost {
	return &WailsDialogHost{app: app}
}

// AttachWindow associates dialogs with the main window when available.
func (h *WailsDialogHost) AttachWindow(window *application.WebviewWindow) {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.window = window
	h.mu.Unlock()
}

// Confirm implements server.ShellDialogHost.
func (h *WailsDialogHost) Confirm(ctx context.Context, message, title string) (bool, error) {
	if h == nil || h.app == nil {
		return false, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if title == "" {
		title = "Autoto"
	}
	type result struct {
		accepted bool
		err      error
	}
	done := make(chan result, 1)
	application.InvokeSync(func() {
		accepted := false
		dialog := h.app.Dialog.Question().
			SetTitle(title).
			SetMessage(message)
		if window := h.mainWindow(); window != nil {
			dialog.AttachToWindow(window)
		}
		yes := dialog.AddButton("OK")
		yes.OnClick(func() { accepted = true })
		dialog.SetDefaultButton(yes)
		no := dialog.AddButton("Cancel")
		no.OnClick(func() { accepted = false })
		dialog.SetCancelButton(no)
		dialog.Show()
		done <- result{accepted: accepted}
	})
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case res := <-done:
		return res.accepted, res.err
	}
}

// Alert implements server.ShellDialogHost.
func (h *WailsDialogHost) Alert(ctx context.Context, message, title string) error {
	if h == nil || h.app == nil {
		return context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if title == "" {
		title = "Autoto"
	}
	done := make(chan error, 1)
	application.InvokeSync(func() {
		dialog := h.app.Dialog.Info().
			SetTitle(title).
			SetMessage(message)
		if window := h.mainWindow(); window != nil {
			dialog.AttachToWindow(window)
		}
		ok := dialog.AddButton("OK")
		dialog.SetDefaultButton(ok)
		dialog.Show()
		done <- nil
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		return err
	}
}

// PickDirectory implements server.ShellDialogHost.
func (h *WailsDialogHost) PickDirectory(ctx context.Context, title, defaultPath string) (string, bool, error) {
	if h == nil || h.app == nil {
		return "", true, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return "", true, err
	}
	if title == "" {
		title = "Select folder"
	}
	type result struct {
		path     string
		canceled bool
		err      error
	}
	done := make(chan result, 1)
	application.InvokeSync(func() {
		dialog := h.app.Dialog.OpenFile().
			SetTitle(title).
			CanChooseFiles(false).
			CanChooseDirectories(true).
			CanCreateDirectories(true)
		if window := h.mainWindow(); window != nil {
			dialog.AttachToWindow(window)
		}
		if dir := strings.TrimSpace(defaultPath); dir != "" {
			dialog.SetDirectory(dir)
		}
		path, err := dialog.PromptForSingleSelection()
		if err != nil {
			// User cancel surfaces as empty path and/or error depending on platform.
			msg := strings.ToLower(err.Error())
			if path == "" || strings.Contains(msg, "cancel") || strings.Contains(msg, "abort") {
				done <- result{canceled: true}
				return
			}
			done <- result{err: err}
			return
		}
		path = strings.TrimSpace(path)
		if path == "" {
			done <- result{canceled: true}
			return
		}
		done <- result{path: path}
	})
	select {
	case <-ctx.Done():
		return "", true, ctx.Err()
	case res := <-done:
		return res.path, res.canceled, res.err
	}
}

// PickFile implements server.ShellDialogHost.
func (h *WailsDialogHost) PickFile(ctx context.Context, title, defaultPath string, filters []server.ShellFileFilter) (string, bool, error) {
	if h == nil || h.app == nil {
		return "", true, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return "", true, err
	}
	if title == "" {
		title = "Select file"
	}
	type result struct {
		path     string
		canceled bool
		err      error
	}
	done := make(chan result, 1)
	application.InvokeSync(func() {
		dialog := h.app.Dialog.OpenFile().
			SetTitle(title).
			CanChooseFiles(true).
			CanChooseDirectories(false)
		if window := h.mainWindow(); window != nil {
			dialog.AttachToWindow(window)
		}
		if dir := strings.TrimSpace(defaultPath); dir != "" {
			dialog.SetDirectory(dir)
		}
		for _, filter := range filters {
			name := strings.TrimSpace(filter.Name)
			pattern := strings.TrimSpace(filter.Pattern)
			if name == "" || pattern == "" {
				continue
			}
			dialog.AddFilter(name, pattern)
		}
		path, err := dialog.PromptForSingleSelection()
		if err != nil {
			msg := strings.ToLower(err.Error())
			if path == "" || strings.Contains(msg, "cancel") || strings.Contains(msg, "abort") {
				done <- result{canceled: true}
				return
			}
			done <- result{err: err}
			return
		}
		path = strings.TrimSpace(path)
		if path == "" {
			done <- result{canceled: true}
			return
		}
		done <- result{path: path}
	})
	select {
	case <-ctx.Done():
		return "", true, ctx.Err()
	case res := <-done:
		return res.path, res.canceled, res.err
	}
}

func (h *WailsDialogHost) mainWindow() *application.WebviewWindow {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.window
}
