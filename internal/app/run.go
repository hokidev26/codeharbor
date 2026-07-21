package app

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"autoto/internal/agent"
	"autoto/internal/channels"
)

// Options configures CLI or desktop-hosted runtime startup.
type Options struct {
	LegacyCommand bool
	// ConfigPath is the resolved or unresolved config path. When empty, Run
	// parses --config from Args (or os.Args).
	ConfigPath string
	// Args are command-line arguments without the program name. When nil, Run
	// uses os.Args[1:].
	Args []string
	// EphemeralHTTP binds the main HTTP listener to host:0 so desktop shells
	// avoid clashing with a long-lived CLI instance on the configured port.
	EphemeralHTTP bool
	// Logger overrides the process logger. When nil, a stdout text logger is used.
	Logger *slog.Logger
}

type channelApprovalAdapter struct {
	runner *agent.Runner
}

func (a channelApprovalAdapter) ApproveToolCall(ctx context.Context, agentID, toolUseID string, decision channels.ApprovalDecision) (bool, error) {
	return a.runner.ApproveToolCall(ctx, agentID, toolUseID, agent.ToolApprovalDecision{
		Decision: decision.Decision, Reason: decision.Reason, DecidedBy: decision.DecidedBy,
		PermissionGeneration: decision.PermissionGeneration, PolicyGeneration: decision.PolicyGeneration,
	})
}

// Run is the canonical process entry for cmd/autoto and the legacy shim.
// Desktop shells should prefer NewRuntime + Start + Close so they can own the
// window lifecycle without process signals.
func Run(options Options) int {
	logger := options.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
		slog.SetDefault(logger)
		options.Logger = logger
	}

	args := options.Args
	if args == nil {
		args = os.Args[1:]
	}
	if options.ConfigPath == "" {
		flags := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
		configPath := flags.String("config", "", "path to config.json")
		if err := flags.Parse(args); err != nil {
			return 2
		}
		options.ConfigPath = *configPath
	}

	rt, err := NewRuntime(options)
	if err != nil {
		logger.Error("create runtime", "error", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := rt.Start(ctx); err != nil {
		logger.Error("start runtime", "error", err)
		_ = rt.Close(context.Background())
		return 1
	}

	select {
	case <-ctx.Done():
	case <-rt.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := rt.Close(shutdownCtx); err != nil {
		logger.Error("shutdown", "error", err)
		return 1
	}
	return 0
}
