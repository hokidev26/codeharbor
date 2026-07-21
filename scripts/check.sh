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

printf '==> Checking source file size budget\n'
# Guard against source files growing back into unmaintainable giants after the
# structure-split work. Implementation .go/.mjs files stay under 1500 lines; CSS
# (split by cascade section) stays under 6000. Test files, locale-data catalogs,
# and legacy trees are exempt. Files still awaiting their own split are
# grandfathered in size_allowlist — shrink that list as they are split; adding to
# it should be rare and justified. New files over budget, or a split file
# regrowing past budget, fail here.
size_budget_go=1500
size_budget_mjs=1500
size_budget_css=6000
size_allowlist=(
  "internal/db/automation_p2p3.go"
  "internal/db/migrations.go"
  "internal/agent/context_ask.go"
  "internal/server/agent.go"
  "internal/server/provider_config.go"
  "internal/server/static/modules/app-main.mjs"
  "internal/server/static/modules/chat-rendering.mjs"
  "internal/server/static/modules/provider-console.mjs"
)
size_violations=""
size_check_one() {
  local file="$1" budget="$2" allowed
  for allowed in "${size_allowlist[@]}"; do
    [[ "$file" == "$allowed" ]] && return 0
  done
  local lines
  lines="$(wc -l < "$file" | tr -d ' ')"
  if (( lines > budget )); then
    size_violations+=$'\n'"  $file: $lines lines (budget $budget)"
  fi
}
while IFS= read -r file; do
  size_check_one "$file" "$size_budget_go"
done < <(find cmd internal -name '*.go' ! -name '*_test.go')
while IFS= read -r file; do
  size_check_one "$file" "$size_budget_mjs"
done < <(find internal/server/static -name '*.mjs' ! -name '*.test.mjs' ! -name 'messages-*.mjs')
while IFS= read -r file; do
  size_check_one "$file" "$size_budget_css"
done < <(find internal/server/static -name '*.css')
if [[ -n "$size_violations" ]]; then
  printf 'The following files exceed the size budget:%s\n' "$size_violations"
  printf 'Split them into cohesive modules, or (only with justification) add to size_allowlist in scripts/check.sh.\n'
  exit 1
fi

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
