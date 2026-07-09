.PHONY: check fmt

check:
	./scripts/check.sh

fmt:
	gofmt -w ./cmd ./internal
