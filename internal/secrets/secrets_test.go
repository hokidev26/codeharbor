package secrets

import (
	"context"
	"strings"
	"testing"
)

func TestParseRefAndEnvResolver(t *testing.T) {
	ref, err := ParseRef("env:INTEGRATION_API_KEY")
	if err != nil {
		t.Fatal(err)
	}
	if ref.Scheme != EnvScheme || ref.Name != "INTEGRATION_API_KEY" || ref.String() != "env:INTEGRATION_API_KEY" {
		t.Fatalf("unexpected parsed reference: %+v", ref)
	}
	const value = "super-secret-value"
	resolver := EnvResolver{LookupEnv: func(name string) (string, bool) {
		if name != "INTEGRATION_API_KEY" {
			t.Fatalf("unexpected environment name: %s", name)
		}
		return value, true
	}}
	resolved, err := resolver.Resolve(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != value {
		t.Fatalf("unexpected resolved value")
	}
}

func TestEnvResolverMissingAndErrorsDoNotLeakValues(t *testing.T) {
	resolver := EnvResolver{LookupEnv: func(string) (string, bool) { return "must-not-leak", false }}
	_, err := ResolveString(context.Background(), resolver, "env:MISSING_SECRET")
	if err == nil {
		t.Fatal("expected missing environment variable to fail")
	}
	if strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("error leaked secret value: %v", err)
	}
}

func TestParseRefRejectsUnsupportedOrMalformedReferences(t *testing.T) {
	invalid := []string{"", "raw", "file:SECRET", "env:", "env:9BAD", "env:BAD-NAME", "env:BAD NAME", "env:BAD\nNAME", " env:BAD", "env:BAD ", "ENV:NAME"}
	for _, value := range invalid {
		t.Run(strings.ReplaceAll(value, "\n", "newline"), func(t *testing.T) {
			if _, err := ParseRef(value); err == nil {
				t.Fatalf("expected %q to fail", value)
			}
		})
	}
}
