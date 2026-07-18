package themes

// builtInThemes returns original Autoto-owned manifests. The inaugural theme
// uses only controlled colors and server-generated gradients, so it carries no
// third-party or externally fetched artwork.
func builtInThemes() map[string]bundledTheme {
	manifest := Manifest{
		SchemaVersion: SchemaVersionV1,
		ID:            "argentina-spain-final",
		Name:          "Argentina–Spain Final",
		Version:       "1.0.0",
		Description:   "An original blue-white, gold-red, and black-gold match-night atmosphere.",
		Author:        "Autoto",
		ColorScheme:   ColorSchemeDark,
		Tokens: Tokens{
			Canvas: "#07111F", Sidebar: "#0A1C30", Card: "#10263F",
			Input: "#163552", Text: "#F7FBFF", Muted: "#9DB1C8",
			Border: "#75AADB", Primary: "#75AADB", Secondary: "#F1BF00",
			Danger: "#AA151B", Terminal: "#090A0C", Message: "#132B47",
		},
		Materials: Materials{
			Canvas:   Material{Kind: MaterialSolid, Opacity: 1, Blur: 0, Radius: 0, Shadow: ShadowNone},
			Sidebar:  Material{Kind: MaterialGlass, Opacity: 0.9, Blur: 18, Radius: 0, Shadow: ShadowMedium},
			Card:     Material{Kind: MaterialTranslucent, Opacity: 0.94, Blur: 10, Radius: 18, Shadow: ShadowStrong},
			Input:    Material{Kind: MaterialTranslucent, Opacity: 0.96, Blur: 8, Radius: 14, Shadow: ShadowSoft},
			Terminal: Material{Kind: MaterialSolid, Opacity: 1, Blur: 0, Radius: 14, Shadow: ShadowStrong},
			Message:  Material{Kind: MaterialGlass, Opacity: 0.92, Blur: 12, Radius: 18, Shadow: ShadowMedium},
		},
	}
	return map[string]bundledTheme{
		manifest.ID: {manifest: manifest, resources: map[string][]byte{}},
	}
}
