package main

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

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
	"codeharbor/internal/server"
	"codeharbor/internal/tools"
)

func main() {
	configPath := flag.String("config", "", "path to config.json")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	resolvedConfigPath, err := config.ResolvePath(*configPath)
	if err != nil {
		logger.Error("resolve config", "error", err)
		os.Exit(1)
	}
	cfg, err := config.Load(resolvedConfigPath)
	if err != nil {
		logger.Error("load config", "error", err)
		os.Exit(1)
	}

	store, err := db.Open(context.Background(), cfg.Paths.DatabasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	if err := store.SeedBackends(context.Background(), configuredBackends(cfg.Backends.Instances)); err != nil {
		logger.Error("seed backends", "error", err)
		os.Exit(1)
	}

	providerRegistry := providers.NewRegistry()
	for _, providerCfg := range cfg.Providers.Instances {
		switch providerCfg.Type {
		case "openai":
			providerRegistry.Register(providers.NewOpenAIOfficial(providerCfg))
		case "anthropic":
			providerRegistry.Register(providers.NewAnthropicProvider(providerCfg))
		case "openai-compatible":
			providerRegistry.Register(providers.NewOpenAICompatible(providerCfg))
		default:
			logger.Warn("skip unknown provider type", "name", providerCfg.Name, "type", providerCfg.Type)
		}
	}

	toolRegistry := tools.NewRegistry()
	tools.RegisterCore(toolRegistry)

	hub := agent.NewHub()
	runner := agent.NewRunner(store, providerRegistry, toolRegistry, hub, cfg.Agent)
	notifier := server.NewWebhookNotifier(store)
	runner.SetNotifier(notifier)
	app := server.New(cfg, store, runner, hub, providerRegistry)
	app.SetWebhookNotifier(notifier)
	app.SetConfigPath(resolvedConfigPath)

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           app.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("codeharbor listening", "addr", fmt.Sprintf("http://%s", cfg.Addr()))
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
	}
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
