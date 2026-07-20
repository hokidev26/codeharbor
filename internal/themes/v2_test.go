package themes

import (
	"bytes"
	"encoding/json"
	"errors"
	"image/color"
	"strings"
	"testing"
)

func TestSchemaV2BackgroundsIconsAndCapabilities(t *testing.T) {
	manifest := testManifest()
	manifest.SchemaVersion = SchemaVersionV2
	manifest.HomeBackground = nil
	manifest.Preview = ""
	manifest.Backgrounds = &Backgrounds{
		Global: &BackgroundAsset{Path: "assets/global.png", PositionX: intPointer(25), PositionY: intPointer(40), FallbackOpacity: 0.35},
		Home:   &BackgroundAsset{Path: "assets/home.webp", PositionX: intPointer(75), PositionY: intPointer(60), FallbackOpacity: 0.8},
	}
	manifest.Icons = map[string]string{"brand": "icons/brand.png", "rail-home": "icons/home.webp"}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseManifest(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.SchemaVersion != SchemaVersionV2 || parsed.Backgrounds.Global.PositionX == nil || *parsed.Backgrounds.Global.PositionX != 25 || parsed.Backgrounds.Global.PositionY == nil || *parsed.Backgrounds.Global.PositionY != 40 || parsed.Icons["brand"] != "icons/brand.png" {
		t.Fatalf("parsed v2 manifest = %#v", parsed)
	}
	if got := capabilitiesForManifest(parsed); got != (ThemeCapabilities{GlobalBackground: true, HomeBackground: true, Icons: true}) {
		t.Fatalf("capabilities = %#v", got)
	}

	cases := []struct {
		name   string
		mutate func(*Manifest)
	}{
		{"global position", func(m *Manifest) { m.Backgrounds.Global.PositionX = intPointer(101) }},
		{"home fallback opacity", func(m *Manifest) { m.Backgrounds.Home.FallbackOpacity = -0.1 }},
		{"unknown icon", func(m *Manifest) { m.Icons["toolbar-upload"] = "icons/upload.png" }},
		{"icon JPEG", func(m *Manifest) { m.Icons["brand"] = "icons/brand.jpg" }},
		{"legacy home field", func(m *Manifest) { m.HomeBackground = &HomeBackground{Path: "assets/legacy.png", Scope: "home"} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value := parsed
			tc.mutate(&value)
			if err := ValidateManifest(value); err == nil {
				t.Fatal("ValidateManifest unexpectedly succeeded")
			}
		})
	}
}

func TestSchemaV2CSSUsesSafeGlobalHomeAndIconVariables(t *testing.T) {
	manifest := testManifest()
	manifest.SchemaVersion = SchemaVersionV2
	manifest.HomeBackground = nil
	manifest.Preview = ""
	manifest.Backgrounds = &Backgrounds{
		Global: &BackgroundAsset{Path: "assets/global.png", PositionX: intPointer(12), PositionY: intPointer(34), FallbackOpacity: 0.45},
		Home:   &BackgroundAsset{Path: "assets/home.webp", PositionX: intPointer(88), PositionY: intPointer(66)},
	}
	manifest.Icons = map[string]string{"brand": "icons/brand.png", "sidebar-search": "icons/search.webp"}
	resources := map[string][]byte{
		"assets/global.png": testPNG(t, color.Black), "assets/home.webp": testWebPVP8L(2, 2),
		"icons/brand.png": testPNG(t, color.White), "icons/search.webp": testWebPVP8L(2, 2),
	}
	revision, err := hashThemeContent(manifest, resources, nil)
	if err != nil {
		t.Fatal(err)
	}
	css, err := GenerateCSS(newThemeMetadata(manifest, revision, false, nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{
		"--autoto-theme-global-image: url(\"/themes/test-theme/" + revision + "/assets/global.png\");",
		"--autoto-theme-global-position: 12% 34%;",
		"--autoto-theme-global-fallback-opacity: 0.45;",
		"--autoto-theme-home-position: 88% 66%;",
		"--autoto-icon-brand: url(\"/themes/test-theme/" + revision + "/icons/brand.png\");",
		"--autoto-icon-brand-fallback-opacity: 0;",
		"--autoto-icon-sidebar-search: url(\"/themes/test-theme/" + revision + "/icons/search.webp\");",
		"--autoto-icon-rail-settings: none;",
		"--autoto-icon-rail-settings-fallback-opacity: 1;",
	} {
		if !strings.Contains(css, value) {
			t.Errorf("CSS missing %q:\n%s", value, css)
		}
	}
	if strings.Contains(css, "http://") || strings.Contains(css, "https://") || strings.Contains(css, "<script") {
		t.Fatal("unsafe content in generated CSS")
	}
}

func intPointer(value int) *int { return &value }

func TestSchemaV2ArchiveRequiresDeclaredRoleResources(t *testing.T) {
	manifest := testManifest()
	manifest.SchemaVersion = SchemaVersionV2
	manifest.HomeBackground = nil
	manifest.Preview = ""
	manifest.Backgrounds = &Backgrounds{Global: &BackgroundAsset{Path: "backgrounds/global.png", PositionX: intPointer(50), PositionY: intPointer(50)}}
	manifest.Icons = map[string]string{"brand": "icons/brand.png"}
	valid := []zipTestEntry{
		{name: ManifestFilename, data: mustManifestJSON(t, manifest)},
		{name: manifest.Backgrounds.Global.Path, data: testPNG(t, color.Black)},
		{name: manifest.Icons["brand"], data: testPNG(t, color.White)},
	}
	store := newTestStore(t)
	if _, err := store.Import(bytes.NewReader(makeArchive(t, valid)), ImportOptions{}); err != nil {
		t.Fatalf("valid v2 import = %v", err)
	}
	missing := []zipTestEntry{{name: ManifestFilename, data: mustManifestJSON(t, manifest)}, {name: manifest.Backgrounds.Global.Path, data: testPNG(t, color.Black)}}
	if _, err := newTestStore(t).Import(bytes.NewReader(makeArchive(t, missing)), ImportOptions{}); !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("missing icon error = %v", err)
	}
}
