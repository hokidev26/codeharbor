package agent

import (
	"autoto/internal/pricing"
	"autoto/internal/providers"
)

func estimateUsageCostUSD(providerName, model string, usage providers.Usage) float64 {
	return pricing.EstimateUsageCostUSD(providerName, model, pricing.Usage{
		InputTokens:       usage.InputTokens,
		OutputTokens:      usage.OutputTokens,
		CachedInputTokens: usage.CachedInputTokens,
		ReasoningTokens:   usage.ReasoningTokens,
	})
}
