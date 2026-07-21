#!/usr/bin/env bash
# Development/release helper for desktop + CLI binaries.
# Does NOT notarize or Authenticode-sign; see docs/DESKTOP_PACKAGING.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
OUT="${OUT:-dist}"
mkdir -p "$OUT"
echo "Building Autoto $VERSION → $OUT"

# config.Version is a package-level string var so -X can rewrite it.
LDFLAGS="-X autoto/internal/config.Version=${VERSION}"

echo "→ CLI"
go build -ldflags "$LDFLAGS" -o "$OUT/autoto" ./cmd/autoto

echo "→ desktop (tags=desktop,production)"
# production disables Wails debug/devtools mode for release-like binaries.
go build -tags "desktop,production" -ldflags "$LDFLAGS" -o "$OUT/autoto-desktop" ./cmd/autoto-desktop

(
  cd "$OUT"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 autoto autoto-desktop > SHA256SUMS
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum autoto autoto-desktop > SHA256SUMS
  fi
)

echo "Done."
echo "  CLI:     $OUT/autoto"
echo "  Desktop: $OUT/autoto-desktop"
echo "  Sums:    $OUT/SHA256SUMS (if available)"
echo "Signing/notarization is intentionally out of band."
