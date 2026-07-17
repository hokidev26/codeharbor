package app

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"autoto/internal/agent"
	"autoto/internal/anthropicauth"
	"autoto/internal/audit"
	"autoto/internal/automation"
	"autoto/internal/background"
	"autoto/internal/channels"
	"autoto/internal/codexauth"
	"autoto/internal/compat"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/integrations"
	"autoto/internal/plugins"
	"autoto/internal/preview"
	"autoto/internal/providers"
	"autoto/internal/runtime"
	"autoto/internal/secrets"
	"autoto/internal/server"
	"autoto/internal/tools"
)

type Options struct {
	LegacyCommand bool
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

func Run(options Options) int {
	flags := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	configPath := flags.String("config", "", "path to config.json")
	if err := flags.Parse(os.Args[1:]); err != nil {
		return 2
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	if options.LegacyCommand {
		logger.Warn("codeharbor command is deprecated; use autoto", "replacement", "autoto", "removalVersion", compat.RemovalVersion)
	}

	resolvedConfigPath, err := config.ResolvePath(*configPath)
	if err != nil {
		logger.Error("resolve config", "error", err)
		return 1
	}
	cfg, legacyReport, err := config.LoadWithReport(resolvedConfigPath)
	if err != nil {
		logger.Error("load config", "error", err)
		return 1
	}
	if !legacyReport.Empty() {
		logger.Warn(
			"legacy compatibility used",
			"legacy", legacyReport.LegacyNames(),
			"replacement", legacyReport.Replacements(),
			"removalVersion", compat.RemovalVersion,
		)
	}

	store, err := db.Open(context.Background(), cfg.Paths.DatabasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		return 1
	}
	defer store.Close()
	runtimeSettings, err := store.GetRuntimeSettings(context.Background())
	if err != nil {
		logger.Error("load runtime settings", "error", err)
		return 1
	}
	if err := store.SeedBackends(context.Background(), configuredBackends(cfg.Backends.Instances)); err != nil {
		logger.Error("seed backends", "error", err)
		return 1
	}

	providerRegistry := providers.NewRegistry()
	providerRegistry.SetAggregateSource(aggregateSourceFromStore(store))
	for _, providerCfg := range cfg.Providers.Instances {
		if providerCfg.Disabled {
			logger.Info("skip disabled provider", "name", providerCfg.Name, "type", providerCfg.Type)
			continue
		}
		providerCfg = providerConfigForRuntime(providerCfg, runtimeSettings)
		if providerCfg.Type == config.ProviderTypeCodex {
			providerCfg.CredentialStorePath = codexauth.DefaultStoreDir(cfg.Paths.HomeDir)
		}
		if providerCfg.Name == anthropicauth.DefaultProviderName && providerCfg.Type == "anthropic" {
			providerCfg.CredentialStorePath = anthropicauth.DefaultStoreDir(cfg.Paths.HomeDir)
		}
		provider, err := providers.NewProvider(providerCfg)
		if err != nil {
			logger.Warn("skip unsupported provider", "name", providerCfg.Name, "type", providerCfg.Type, "error", err)
			continue
		}
		if codexProvider, ok := provider.(*providers.CodexProvider); ok {
			codexProvider.SetAccountTelemetry(store)
		}
		if anthropicProvider, ok := provider.(*providers.AnthropicProvider); ok {
			anthropicProvider.SetAccountTelemetry(store)
		}
		providerRegistry.Register(provider)
	}
	if !providerRegistry.SetDefaultFromConfig(cfg.Agent.DefaultModel, cfg.Providers.Instances) {
		logger.Warn("no configured provider registered as default", "defaultModel", cfg.Agent.DefaultModel)
	}

	toolRegistry := tools.NewRegistry()
	tools.RegisterCore(toolRegistry)
	secretResolver := secrets.EnvResolver{}
	pluginService := plugins.NewService(store, secretResolver)

	hub := agent.NewHub()
	runner := agent.NewRunner(store, providerRegistry, toolRegistry, hub, cfg.Agent)
	runner.SetDynamicToolSource(pluginService)
	runner.SetDefaultReasoningEffort(runtimeSettings.DefaultReasoningEffort)
	if err := runner.RecoverInterruptedRuns(context.Background()); err != nil {
		logger.Error("recover interrupted runs", "error", err)
		return 1
	}
	connectionService := integrations.NewConnectionService(store, secretResolver)
	auditRecorder := audit.NewRecorder(store)
	automationManager, err := automation.NewManager(automation.Config{Store: store, Runner: runner, Audit: auditRecorder})
	if err != nil {
		logger.Error("create automation manager", "error", err)
		return 1
	}
	channelManager, err := channels.New(store, connectionService, channelApprovalAdapter{runner: runner}, toolRegistry)
	if err != nil {
		logger.Error("create channel manager", "error", err)
		return 1
	}
	automationManager.SetTelegramSender(channelManager)
	runner.SetNotifier(automationManager)

	backgroundManager := background.NewManager(store, background.Options{})
	if err := backgroundManager.RegisterExecutor(db.BackgroundTaskKindShell, background.NewShellExecutor()); err != nil {
		logger.Error("register background shell executor", "error", err)
		return 1
	}
	if err := backgroundManager.RegisterExecutor(db.BackgroundTaskKindAgent, background.NewAgentExecutor(store, runner)); err != nil {
		logger.Error("register background agent executor", "error", err)
		return 1
	}
	backgroundService := background.NewService(backgroundManager, store)
	backgroundManager.SetValidator(runner.ValidateBackgroundTask)
	eventHook, terminalHook := background.NewManagerHooks(hub, automationManager, runner)
	backgroundManager.SetEventHook(eventHook)
	backgroundManager.SetTerminalHook(terminalHook)
	runner.SetBackgroundTaskService(backgroundService)

	previewManager := preview.NewManager()
	reviewService := server.NewReviewService(providerRegistry, cfg.Agent.ReviewModel)
	runner.SetReviewService(reviewService)
	application := server.New(cfg, store, runner, hub, providerRegistry)
	application.SetToolRegistry(toolRegistry)
	application.SetBackgroundTaskService(backgroundService)
	application.SetAutomationManager(automationManager)
	application.SetConnectionService(connectionService)
	application.SetPluginService(pluginService)
	application.SetReviewService(reviewService)
	application.SetAuditRecorder(auditRecorder)
	application.SetPreviewManager(previewManager)
	application.SetConfigPath(resolvedConfigPath)

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           application.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	supervisor := runtime.NewSupervisor()
	httpService := runtime.NewHTTPService(httpServer, func(err error) {
		logger.Error("serve", "error", err)
		stop()
	})
	if err := registerRuntimeServices(supervisor, previewManager, channelManager, automationManager, backgroundManager, httpService); err != nil {
		logger.Error("register service", "error", err)
		return 1
	}

	logger.Info("autoto listening", "addr", fmt.Sprintf("http://%s", cfg.Addr()))
	if err := supervisor.Start(ctx); err != nil {
		logger.Error("start services", "error", err)
		return 1
	}
	// Background reconciliation runs as part of the supervisor start. Only then
	// can a continuation safely decide whether its task boundary is terminal.
	if err := runner.RecoverContinuationPendingRuns(context.Background()); err != nil {
		logger.Error("recover continuation pending runs", "error", err)
		return 1
	}

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := supervisor.Close(shutdownCtx); err != nil {
		logger.Error("shutdown", "error", err)
		return 1
	}
	return 0
}

func registerRuntimeServices(supervisor *runtime.Supervisor, services ...runtime.Service) error {
	for _, service := range services {
		if err := supervisor.Register(service); err != nil {
			return err
		}
	}
	return nil
}

func providerConfigForRuntime(providerCfg config.ProviderConfig, settings db.RuntimeSettings) config.ProviderConfig {
	providerCfg.ClientVersion = config.Version
	providerCfg.InstallationID = settings.InstallationID
	return providerCfg
}

func aggregateSourceFromStore(store *db.Store) providers.AggregateSource {
	return providers.AggregateSourceFunc(func(ctx context.Context, name string) (providers.AggregateDefinition, error) {
		aggregate, err := store.GetModelAggregate(ctx, name)
		if err != nil {
			return providers.AggregateDefinition{}, err
		}
		return providers.AggregateDefinition{
			Name:    aggregate.Name,
			Mode:    aggregate.Mode,
			Members: append([]string(nil), aggregate.Members...),
		}, nil
	})
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
