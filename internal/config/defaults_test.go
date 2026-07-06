package config

import "testing"

func TestDefaultConfig(t *testing.T) {
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Port != 7788 {
		t.Fatalf("expected default port 7788, got %d", cfg.Server.Port)
	}
	if cfg.Paths.HomeDir == "" || cfg.Paths.DatabasePath == "" {
		t.Fatal("expected default paths")
	}
	if cfg.Agent.DefaultPermissionMode == "" {
		t.Fatal("expected default permission mode")
	}
}

func TestDefaultBackendsFromEnv(t *testing.T) {
	t.Setenv("CODEHARBOR_AGENT_BACKEND_URL", "http://127.0.0.1:8000/")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_API_KEY", "secret")

	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Backends.Instances) != 1 {
		t.Fatalf("expected one backend, got %d", len(cfg.Backends.Instances))
	}
	backend := cfg.Backends.Instances[0]
	if backend.BaseURL != "http://127.0.0.1:8000" || backend.APIKey != "secret" || !backend.Active {
		t.Fatalf("unexpected backend seed: %+v", backend)
	}
}
