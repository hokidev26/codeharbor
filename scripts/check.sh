#!/usr/bin/env bash
set -euo pipefail

# Default checks stay free of Wails/native WebView so Linux CI and headless
# developers can validate the browser CLI path. Desktop shell is opt-in:
#   AUTOTO_CHECK_DESKTOP=1 ./scripts/check.sh
#   make check-desktop

printf '==> Checking Go formatting\n'
unformatted="$(gofmt -l ./cmd ./internal)"
if [[ -n "$unformatted" ]]; then
  printf 'The following files need gofmt:\n%s\n' "$unformatted"
  printf 'Run `make fmt` or `gofmt -w ./cmd ./internal` to format them.\n'
  exit 1
fi

printf '==> Checking Go module tidiness\n'
go mod tidy -diff

printf '==> Running Go tests (default tags; desktop package excluded)\n'
go test ./...

printf '==> Running go vet (default tags)\n'
go vet ./...

printf '==> Building Go packages (default tags; CLI path)\n'
go build ./...
# Explicit CLI entrypoint so a future build-tag regression is obvious.
go build -o /dev/null ./cmd/autoto

./scripts/deadcode.sh

printf '==> Checking embedded JavaScript syntax\n'
node --version
node --check internal/server/static/app.js
for file in internal/server/static/modules/*.mjs; do
  node --check "$file"
done

printf '==> Running embedded JavaScript tests\n'
node --test internal/server/static/modules/*.test.mjs

if [[ "${AUTOTO_CHECK_DESKTOP:-}" == "1" ]]; then
  printf '==> Desktop shell (build tag desktop)\n'
  go test -tags desktop ./internal/desktop/ -count=1
  go build -tags desktop -o /dev/null ./cmd/autoto-desktop
  printf '==> Desktop checks passed\n'
else
  printf '==> Skipping desktop shell (set AUTOTO_CHECK_DESKTOP=1 to include)\n'
fi

printf '==> All checks passed\n'
