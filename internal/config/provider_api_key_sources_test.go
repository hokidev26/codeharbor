package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectProviderAPIKeyInputsDistinguishesLegacyConfigFromDefaults(t *testing.T) {
	tempDir := t.TempDir()
	path := filepath.Join(tempDir, "config.json")
	if err := os.WriteFile(path, []byte(`{"providers":{"instances":[{"name":"relay","apiKey":"legacy-secret"}]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Providers: ProvidersConfig{Instances: []ProviderConfig{
		{Name: "relay", APIKey: "legacy-secret"},
		{Name: "environment-backed", APIKey: "env-secret"},
	}}}
	inputs, err := InspectProviderAPIKeyInputs(path, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if inputs["relay"].Source != ProviderAPIKeySourceLegacyConfig || inputs["relay"].APIKey != "legacy-secret" {
		t.Fatalf("legacy source = %+v", inputs["relay"])
	}
	if inputs["environment-backed"].Source != ProviderAPIKeySourceEnvironment || inputs["environment-backed"].APIKey != "env-secret" {
		t.Fatalf("environment source = %+v", inputs["environment-backed"])
	}
}

func TestInspectProviderAPIKeyInputsDoesNotTreatMissingConfigAsLegacy(t *testing.T) {
	cfg := Config{Providers: ProvidersConfig{Instances: []ProviderConfig{{Name: "relay", APIKey: "env-secret"}}}}
	inputs, err := InspectProviderAPIKeyInputs(filepath.Join(t.TempDir(), "missing.json"), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if inputs["relay"].Source != ProviderAPIKeySourceEnvironment {
		t.Fatalf("source = %+v", inputs["relay"])
	}
}

func TestInspectProviderAPIKeyInputsEnvironmentOverridesLegacyConfig(t *testing.T) {
	t.Setenv("OPENAI_COMPATIBLE_API_KEY", "environment-secret")
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"providers":{"instances":[{"name":"relay","type":"openai-compatible","apiKey":"legacy-secret"}]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Providers: ProvidersConfig{Instances: []ProviderConfig{{Name: "relay", Type: "openai-compatible", APIKey: "legacy-secret"}}}}
	inputs, err := InspectProviderAPIKeyInputs(path, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if inputs["relay"].Source != ProviderAPIKeySourceEnvironment || inputs["relay"].APIKey != "environment-secret" || !inputs["relay"].LegacyConfigPresent {
		t.Fatalf("environment did not override legacy config safely: %+v", inputs["relay"])
	}
}

func TestInspectProviderTransportSecretInputsFindsLegacyPlaintext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"providers":{"instances":[{"name":"relay","proxyUrl":"http://proxy-user:proxy-pass@127.0.0.1:7890","requestHeaders":[{"name":"X-Tenant","value":"tenant-secret"},{"name":"X-Empty","value":""}]}],"openaiCompatible":{"proxyUrl":"socks5://legacy-user:legacy-pass@127.0.0.1:1080","requestHeaders":[{"name":"X-Legacy","value":"legacy-secret"}]}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	inputs, err := InspectProviderTransportSecretInputs(path)
	if err != nil {
		t.Fatal(err)
	}
	relay := inputs["relay"]
	if relay.ProxyUsername != "proxy-user" || relay.ProxyPassword != "proxy-pass" || !relay.LegacyProxyAuthPresent || !relay.LegacyRequestHeadersPresent {
		t.Fatalf("unexpected relay transport input: %+v", relay)
	}
	if len(relay.RequestHeaders) != 1 || relay.RequestHeaders[0].Name != "X-Tenant" || relay.RequestHeaders[0].Value != "tenant-secret" {
		t.Fatalf("unexpected relay headers: %+v", relay.RequestHeaders)
	}
	legacy := inputs["openai-compatible"]
	if legacy.ProxyUsername != "legacy-user" || legacy.ProxyPassword != "legacy-pass" || len(legacy.RequestHeaders) != 1 || legacy.RequestHeaders[0].Value != "legacy-secret" {
		t.Fatalf("unexpected legacy transport input: %+v", legacy)
	}
}
