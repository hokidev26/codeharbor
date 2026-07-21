//go:build desktop

package desktop

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const autostartIdentifier = "com.autoto.desktop"

// ShellAutostart exposes login-item control for the desktop shell only.
// Remote browsers never call this; it is tray/menu + optional local HTTP.
type ShellAutostart struct {
	app    *application.App
	logger *slog.Logger
}

func NewShellAutostart(app *application.App, logger *slog.Logger) *ShellAutostart {
	if logger == nil {
		logger = slog.Default()
	}
	return &ShellAutostart{app: app, logger: logger}
}

func (s *ShellAutostart) Status() (enabled bool, strategy string, path string, err error) {
	if s == nil || s.app == nil {
		return false, "", "", application.ErrAutostartNotSupported
	}
	st, err := s.app.Autostart.Status()
	if err != nil {
		return false, "", "", err
	}
	return st.Enabled, string(st.Strategy), st.Path, nil
}

func (s *ShellAutostart) Enable() error {
	if s == nil || s.app == nil {
		return application.ErrAutostartNotSupported
	}
	return s.app.Autostart.EnableWithOptions(application.AutostartOptions{
		Identifier: autostartIdentifier,
		// Launch into tray-friendly shell without stealing a fixed port.
		Arguments: []string{"-ephemeral-http=true"},
	})
}

func (s *ShellAutostart) Disable() error {
	if s == nil || s.app == nil {
		return application.ErrAutostartNotSupported
	}
	return s.app.Autostart.Disable()
}
