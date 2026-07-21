//go:build desktop

package desktop

import (
	"log/slog"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const autostartIdentifier = "com.autoto.desktop"

// ShellAutostart exposes login-item control for the desktop shell only.
// Remote browsers never call this; it is tray/menu + optional local HTTP.
type ShellAutostart struct {
	app        *application.App
	logger     *slog.Logger
	configPath string
}

func NewShellAutostart(app *application.App, logger *slog.Logger, configPath string) *ShellAutostart {
	if logger == nil {
		logger = slog.Default()
	}
	return &ShellAutostart{
		app:        app,
		logger:     logger,
		configPath: strings.TrimSpace(configPath),
	}
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
	// Launch into tray-friendly shell without stealing a fixed port, and keep
	// the resolved config path so login items open the same profile/database.
	args := []string{"-ephemeral-http=true"}
	if s.configPath != "" {
		args = append(args, "-config", s.configPath)
	}
	return s.app.Autostart.EnableWithOptions(application.AutostartOptions{
		Identifier: autostartIdentifier,
		Arguments:  args,
	})
}

func (s *ShellAutostart) Disable() error {
	if s == nil || s.app == nil {
		return application.ErrAutostartNotSupported
	}
	return s.app.Autostart.Disable()
}
