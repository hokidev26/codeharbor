package agent

import (
	"strings"

	"autoto/internal/providers"
)

type tokenPrice struct {
	InputPerMTok       float64
	CachedInputPerMTok float64
	OutputPerMTok      float64
}

func estimateUsageCostUSD(providerName, model string, usage providers.Usage) float64 {
	price, ok := modelTokenPrice(providerName, model)
	if !ok {
		return 0
	}
	cachedInput := usage.CachedInputTokens
	if cachedInput < 0 {
		cachedInput = 0
	}
	if cachedInput > usage.InputTokens {
		cachedInput = usage.InputTokens
	}
	uncachedInput := usage.InputTokens - cachedInput
	if uncachedInput < 0 {
		uncachedInput = 0
	}
	return (float64(uncachedInput)*price.InputPerMTok + float64(cachedInput)*price.CachedInputPerMTok + float64(usage.OutputTokens)*price.OutputPerMTok) / 1_000_000
}

// modelTokenPrice returns coarse USD-per-million-token estimates used for local usage summaries.
// Pricing references last reviewed on 2026-07-07:
//   - OpenAI API pricing: https://developers.openai.com/api/docs/pricing
//   - OpenAI GPT-4.1 pricing announcement: https://openai.com/index/gpt-4-1/
//   - Anthropic pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
//
// Relay/local models may bill differently from their public model-name match; unknown models return false.
func modelTokenPrice(_ string, model string) (tokenPrice, bool) {
	name := strings.ToLower(strings.TrimSpace(model))
	if _, stripped := providers.SplitModel(name); stripped != name && stripped != "" {
		name = stripped
	}
	openAIPrices := []struct {
		match string
		price tokenPrice
	}{
		{match: "gpt-5.5", price: tokenPrice{InputPerMTok: 5.00, CachedInputPerMTok: 0.50, OutputPerMTok: 22.50}},
		{match: "gpt-5.4-mini", price: tokenPrice{InputPerMTok: 0.375, CachedInputPerMTok: 0.0375, OutputPerMTok: 2.25}},
		{match: "gpt-5.4", price: tokenPrice{InputPerMTok: 2.50, CachedInputPerMTok: 0.25, OutputPerMTok: 11.25}},
		{match: "gpt-4.1-mini", price: tokenPrice{InputPerMTok: 0.40, CachedInputPerMTok: 0.10, OutputPerMTok: 1.60}},
		{match: "gpt-4.1-nano", price: tokenPrice{InputPerMTok: 0.10, CachedInputPerMTok: 0.025, OutputPerMTok: 0.40}},
		{match: "gpt-4.1", price: tokenPrice{InputPerMTok: 2.00, CachedInputPerMTok: 0.50, OutputPerMTok: 8.00}},
		{match: "gpt-4o-mini", price: tokenPrice{InputPerMTok: 0.15, CachedInputPerMTok: 0.075, OutputPerMTok: 0.60}},
		{match: "gpt-4o", price: tokenPrice{InputPerMTok: 2.50, CachedInputPerMTok: 1.25, OutputPerMTok: 10.00}},
	}
	for _, candidate := range openAIPrices {
		if strings.HasPrefix(name, candidate.match) {
			return candidate.price, true
		}
	}

	anthropicPrice := tokenPrice{}
	switch {
	case strings.HasPrefix(name, "claude-sonnet-5"):
		anthropicPrice = tokenPrice{InputPerMTok: 2.00, CachedInputPerMTok: 0.20, OutputPerMTok: 10.00}
	case name == "claude-opus-4" || strings.HasPrefix(name, "claude-opus-4-1") || strings.HasPrefix(name, "claude-opus-4-202"):
		anthropicPrice = tokenPrice{InputPerMTok: 15.00, CachedInputPerMTok: 1.50, OutputPerMTok: 75.00}
	case strings.HasPrefix(name, "claude-opus-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 5.00, CachedInputPerMTok: 0.50, OutputPerMTok: 25.00}
	case strings.HasPrefix(name, "claude-sonnet-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 3.00, CachedInputPerMTok: 0.30, OutputPerMTok: 15.00}
	case strings.HasPrefix(name, "claude-haiku-4"):
		anthropicPrice = tokenPrice{InputPerMTok: 1.00, CachedInputPerMTok: 0.10, OutputPerMTok: 5.00}
	case strings.HasPrefix(name, "claude-3-5-haiku"):
		anthropicPrice = tokenPrice{InputPerMTok: 0.80, CachedInputPerMTok: 0.08, OutputPerMTok: 4.00}
	case strings.HasPrefix(name, "claude-3-5-sonnet") || strings.HasPrefix(name, "claude-3-7-sonnet"):
		anthropicPrice = tokenPrice{InputPerMTok: 3.00, CachedInputPerMTok: 0.30, OutputPerMTok: 15.00}
	}
	if anthropicPrice != (tokenPrice{}) {
		return anthropicPrice, true
	}
	return tokenPrice{}, false
}
