package secrets

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode"
)

const EnvScheme = "env"

// Ref is a parsed logical reference to secret material. It never contains the
// resolved secret value.
type Ref struct {
	Scheme string
	Name   string
}

func (r Ref) String() string {
	if r.Scheme == "" || r.Name == "" {
		return ""
	}
	return r.Scheme + ":" + r.Name
}

// ParseRef parses the phase-one secret reference format env:VARIABLE_NAME.
func ParseRef(value string) (Ref, error) {
	if value == "" || containsWhitespace(value) {
		return Ref{}, errors.New("invalid secret reference")
	}
	scheme, name, ok := strings.Cut(value, ":")
	if !ok || scheme != EnvScheme || !validEnvName(name) {
		return Ref{}, errors.New("invalid secret reference")
	}
	return Ref{Scheme: scheme, Name: name}, nil
}

// Parse is an alias for ParseRef.
func Parse(value string) (Ref, error) { return ParseRef(value) }

// Resolver resolves a validated reference for trusted internal callers.
type Resolver interface {
	Resolve(context.Context, Ref) (string, error)
}

// EnvResolver resolves env: references from the process environment.
type EnvResolver struct {
	LookupEnv func(string) (string, bool)
}

func (r EnvResolver) Resolve(ctx context.Context, ref Ref) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if ref.Scheme != EnvScheme || !validEnvName(ref.Name) {
		return "", errors.New("unsupported secret reference")
	}
	lookup := r.LookupEnv
	if lookup == nil {
		lookup = os.LookupEnv
	}
	value, ok := lookup(ref.Name)
	if !ok {
		return "", errors.New("environment secret is not configured")
	}
	return value, nil
}

// ResolveString parses and resolves a reference without ever including the
// resolved value in an error message.
func ResolveString(ctx context.Context, resolver Resolver, value string) (string, error) {
	ref, err := ParseRef(value)
	if err != nil {
		return "", err
	}
	secret, err := resolver.Resolve(ctx, ref)
	if err != nil {
		return "", fmt.Errorf("resolve secret reference: %w", err)
	}
	return secret, nil
}

func validEnvName(name string) bool {
	if name == "" || len(name) > 256 {
		return false
	}
	for i := 0; i < len(name); i++ {
		char := name[i]
		if (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char == '_' || (i > 0 && char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	return true
}

func containsWhitespace(value string) bool {
	for _, char := range value {
		if unicode.IsSpace(char) {
			return true
		}
	}
	return false
}
