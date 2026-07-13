package app

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/server"
	"autoto/internal/tools"
)

type Options struct {
	LegacyCommand bool
}

func Run(options Options) int {
	flags := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	configPath := flags.String("config", "", "path to config.json")
	if err := flags.Parse(os.Args[1:]); err != nil {
		return 2
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	if options.LegacyCommand {
		logger.Warn("codeharbor command is deprecated; use autoto")
	}

	resolvedConfigPath, err := config.ResolvePath(*configPath)
	if err != nil {
		logger.Error("resolve config", "error", err)
		return 1
	}
	cfg, err := config.Load(resolvedConfigPath)
	if err != nil {
		logger.Error("load config", "error", err)
		return 1
	}

	store, err := db.Open(context.Background(), cfg.Paths.DatabasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		return 1
	}
	defer store.Close()
	if err := store.SeedBackends(context.Background(), configuredBackends(cfg.Backends.Instances)); err != nil {
		logger.Error("seed backends", "error", err)
		return 1
	}

	providerRegistry := providers.NewRegistry()
	for _, providerCfg := range cfg.Providers.Instances {
		provider, err := providers.NewProvider(providerCfg)
		if err != nil {
			logger.Warn("skip unsupported provider", "name", providerCfg.Name, "type", providerCfg.Type, "error", err)
			continue
		}
		providerRegistry.Register(provider)
	}
	if !providerRegistry.SetDefaultFromConfig(cfg.Agent.DefaultModel, cfg.Providers.Instances) {
		logger.Warn("no configured provider registered as default", "defaultModel", cfg.Agent.DefaultModel)
	}

	toolRegistry := tools.NewRegistry()
	tools.RegisterCore(toolRegistry)

	hub := agent.NewHub()
	runner := agent.NewRunner(store, providerRegistry, toolRegistry, hub, cfg.Agent)
	if err := runner.RecoverInterruptedRuns(context.Background()); err != nil {
		logger.Error("recover interrupted runs", "error", err)
		return 1
	}
	notifier := server.NewWebhookNotifier(store)
	runner.SetNotifier(notifier)
	application := server.New(cfg, store, runner, hub, providerRegistry)
	application.SetWebhookNotifier(notifier)
	application.SetConfigPath(resolvedConfigPath)

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           application.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("autoto listening", "addr", fmt.Sprintf("http://%s", cfg.Addr()))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", "error", err)
		return 1
	}
	return 0
}

func configuredBackends(backends []config.BackendConfig) []db.Backend {
	out := make([]db.Backend, 0, len(backends))
	for _, backend := range backends {
		out = append(out, db.Backend{
			ID:      backend.ID,
			Name:    backend.Name,
			Kind:    backend.Kind,
			BaseURL: backend.BaseURL,
			APIKey:  backend.APIKey,
			Active:  backend.Active,
		})
	}
	return out
}
