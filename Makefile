.PHONY: check check-desktop fmt build-cli build-desktop release-desktop

check:
	./scripts/check.sh

# Includes Wails desktop package; needs native WebView toolchain.
check-desktop:
	AUTOTO_CHECK_DESKTOP=1 ./scripts/check.sh

fmt:
	gofmt -w ./cmd ./internal

build-cli:
	go build -o autoto ./cmd/autoto

build-desktop:
	go build -tags desktop -o autoto-desktop ./cmd/autoto-desktop

# Release-like desktop binary (no Wails debug/devtools).
build-desktop-release:
	go build -tags "desktop,production" -ldflags "-X autoto/internal/config.Version=$${VERSION:-dev}" -o autoto-desktop ./cmd/autoto-desktop

# Binaries + SHA256SUMS under dist/. No signing/notarization.
release-desktop:
	./scripts/build-desktop-release.sh