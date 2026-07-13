package agent

import "testing"

func TestModelTokenPriceDoesNotDependOnProviderName(t *testing.T) {
	openAI, ok := modelTokenPrice("custom-relay", "gpt-4.1-mini")
	if !ok || openAI.InputPerMTok != 0.40 {
		t.Fatalf("expected model catalog OpenAI price, got %+v ok=%v", openAI, ok)
	}
	anthropic, ok := modelTokenPrice("custom-relay", "claude-sonnet-4-5")
	if !ok || anthropic.InputPerMTok != 3.00 {
		t.Fatalf("expected model catalog Anthropic price, got %+v ok=%v", anthropic, ok)
	}
	if _, ok := modelTokenPrice("openai", "custom-model"); ok {
		t.Fatal("unknown model must not inherit provider pricing")
	}
}
