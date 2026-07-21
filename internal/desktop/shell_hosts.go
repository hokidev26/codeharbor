//go:build desktop

package desktop

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	updatepkg "autoto/internal/update"
)

// lifecycleHost implements server.ShellLifecycleHost.
type lifecycleHost struct {
	app       *application.App
	window    *application.WebviewWindow
	autostart *ShellAutostart
	logger    *slog.Logger
	mu        sync.RWMutex
	lastLink  string
}

func newLifecycleHost(app *application.App, logger *slog.Logger) *lifecycleHost {
	return &lifecycleHost{
		app:       app,
		autostart: NewShellAutostart(app, logger),
		logger:    logger,
	}
}

func (h *lifecycleHost) AttachWindow(window *application.WebviewWindow) {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.window = window
	h.mu.Unlock()
}

func (h *lifecycleHost) AutostartStatus() (bool, string, string, error) {
	return h.autostart.Status()
}

func (h *lifecycleHost) AutostartEnable() error {
	return h.autostart.Enable()
}

func (h *lifecycleHost) AutostartDisable() error {
	return h.autostart.Disable()
}

func (h *lifecycleHost) NotifyDeepLink(raw string) error {
	link, ok := ParseDeepLink(raw)
	if !ok {
		return fmt.Errorf("unsupported deep link")
	}
	h.mu.Lock()
	h.lastLink = link.Raw
	window := h.window
	h.mu.Unlock()
	if h.logger != nil {
		h.logger.Info("deep link", "url", link.Raw, "target", link.Target)
	}
	if window == nil {
		return nil
	}
	// Navigate within the already-loaded Runtime origin only.
	js := fmt.Sprintf(
		`(function(){try{var t=%q;if(t&&t.charAt(0)==='#'){location.hash=t.slice(1);}else if(t&&t.charAt(0)==='/'){/* keep path; apply hash nav */var i=t.indexOf('#');if(i>=0)location.hash=t.slice(i+1);}window.dispatchEvent(new CustomEvent('autoto:deeplink',{detail:%q}));}catch(e){}})();`,
		link.Target,
		link.Raw,
	)
	window.Show()
	window.Restore()
	window.Focus()
	window.ExecJS(js)
	return nil
}

func (h *lifecycleHost) focusMain() {
	h.mu.RLock()
	window := h.window
	h.mu.RUnlock()
	if window == nil {
		return
	}
	window.Show()
	window.Restore()
	window.Focus()
}

// updateHost implements server.ShellUpdateHost against the Autoto home dir.
type updateHost struct {
	homeDir string
	logger  *slog.Logger
}

func newUpdateHost(homeDir string, logger *slog.Logger) *updateHost {
	return &updateHost{homeDir: strings.TrimSpace(homeDir), logger: logger}
}

func (h *updateHost) StageLocalUpdate(sourcePath, version, sha256 string) (updatepkg.PendingReplace, error) {
	if h == nil || h.homeDir == "" {
		return updatepkg.PendingReplace{}, fmt.Errorf("update home directory unavailable")
	}
	pending, err := updatepkg.StageLocalBinary(h.homeDir, sourcePath, version, sha256)
	if err != nil {
		return updatepkg.PendingReplace{}, err
	}
	if h.logger != nil {
		h.logger.Info("staged local desktop update", "version", pending.Version, "path", pending.StagedPath)
	}
	return pending, nil
}

func (h *updateHost) PendingUpdate() (updatepkg.PendingReplace, bool, error) {
	if h == nil || h.homeDir == "" {
		return updatepkg.PendingReplace{}, false, nil
	}
	return updatepkg.ReadPendingReplace(h.homeDir)
}

func (h *updateHost) ClearPendingUpdate() error {
	if h == nil || h.homeDir == "" {
		return nil
	}
	return updatepkg.ClearPendingReplace(h.homeDir)
}
