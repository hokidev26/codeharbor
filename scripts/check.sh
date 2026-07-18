#!/usr/bin/env bash
set -euo pipefail

printf '==> Checking Go formatting\n'
unformatted="$(gofmt -l ./cmd ./internal)"
if [[ -n "$unformatted" ]]; then
  printf 'The following files need gofmt:\n%s\n' "$unformatted"
  printf 'Run `make fmt` or `gofmt -w ./cmd ./internal` to format them.\n'
  exit 1
fi

printf '==> Checking Go module tidiness\n'
go mod tidy -diff

printf '==> Running Go tests\n'
go test ./...

printf '==> Running go vet\n'
go vet ./...

printf '==> Building Go packages\n'
go build ./...

./scripts/deadcode.sh

printf '==> Checking embedded JavaScript syntax\n'
node --version
node --check internal/server/static/app.js
for file in internal/server/static/modules/*.mjs; do
  node --check "$file"
done

printf '==> Running embedded JavaScript tests\n'
node --test internal/server/static/modules/*.test.mjs

printf '==> All checks passed\n'
