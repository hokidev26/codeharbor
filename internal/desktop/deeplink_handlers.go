//go:build desktop

package desktop

import (
	"log/slog"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// attachDeepLinkHandlers listens for OS URL launches (autoto://) and argv.
func attachDeepLinkHandlers(app *application.App, life *lifecycleHost, logger *slog.Logger) {
	if app == nil || life == nil {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	// Cold start: argv may contain autoto:// on Linux/Windows.
	if raw, ok := FindDeepLinkInArgs(os.Args[1:]); ok {
		go func() {
			if err := life.NotifyDeepLink(raw); err != nil {
				logger.Debug("initial deep link", "error", err, "url", raw)
			}
		}()
	}
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(e *application.ApplicationEvent) {
		raw := e.Context().URL()
		if err := life.NotifyDeepLink(raw); err != nil {
			logger.Debug("application launched with url", "error", err, "url", raw)
		}
	})
}
