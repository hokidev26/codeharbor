package agent

import (
	"math"
	"testing"

	"autoto/internal/providers"
)

func TestEstimateUsageCostUSDUsesSharedPricing(t *testing.T) {
	cost := estimateUsageCostUSD("custom-relay", "gpt-4.1-mini", providers.Usage{
		InputTokens:       1_000_000,
		CachedInputTokens: 250_000,
		OutputTokens:      100_000,
	})
	if math.Abs(cost-0.485) > 0.000001 {
		t.Fatalf("unexpected shared estimate: %.6f", cost)
	}
}
