package providers

import (
	"fmt"
	"strings"
)

// providerRequestFailedText intentionally omits transport errors because they
// can include request URLs, redirect destinations, or credentials.
func providerRequestFailedText(provider string) string {
	return safeProviderErrorName(provider) + " provider request failed"
}

// providerHTTPFailedText exposes only the numeric HTTP status. Response status
// text and bodies are upstream-controlled and can contain URLs or credentials.
func providerHTTPFailedText(provider string, statusCode int) string {
	name := safeProviderErrorName(provider)
	if statusCode < 100 || statusCode > 599 {
		return name + " model request failed"
	}
	return fmt.Sprintf("%s model request failed: %d", name, statusCode)
}

func safeProviderErrorName(provider string) string {
	provider = strings.TrimSpace(provider)
	if provider == "" || len(provider) > 64 || strings.Contains(provider, "://") || strings.ContainsAny(provider, "/\\?#@\r\n\t") || strings.Contains(strings.ToLower(provider), "bearer") || strings.HasPrefix(provider, "eyJ") {
		return "provider"
	}
	return provider
}
