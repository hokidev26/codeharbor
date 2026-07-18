// Package themes implements Autoto's manifest-driven local theme system.
// Theme manifests contain only controlled data; v1 never accepts user CSS,
// HTML, or JavaScript.
package themes

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"unicode/utf8"
)

const (
	SchemaVersionV1  = 1
	ManifestFilename = "manifest.json"
	LicenseFilename  = "LICENSE.txt"

	MaxManifestBytes = 32 << 10
)

const (
	ColorSchemeLight = "light"
	ColorSchemeDark  = "dark"
)

const (
	MaterialSolid       = "solid"
	MaterialTranslucent = "translucent"
	MaterialGlass       = "glass"
)

const (
	ShadowNone   = "none"
	ShadowSoft   = "soft"
	ShadowMedium = "medium"
	ShadowStrong = "strong"
)

// Manifest is the schemaVersion=1 theme description.
type Manifest struct {
	SchemaVersion  int             `json:"schemaVersion"`
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Version        string          `json:"version"`
	Description    string          `json:"description"`
	Author         string          `json:"author"`
	ColorScheme    string          `json:"colorScheme"`
	Tokens         Tokens          `json:"tokens"`
	Materials      Materials       `json:"materials"`
	Preview        string          `json:"preview,omitempty"`
	HomeBackground *HomeBackground `json:"homeBackground,omitempty"`
}

// Tokens is the complete v1 color vocabulary. Values are restricted to hex
// colors, preventing CSS syntax or URL injection.
type Tokens struct {
	Canvas    string `json:"canvas"`
	Sidebar   string `json:"sidebar"`
	Card      string `json:"card"`
	Input     string `json:"input"`
	Text      string `json:"text"`
	Muted     string `json:"muted"`
	Border    string `json:"border"`
	Primary   string `json:"primary"`
	Secondary string `json:"secondary"`
	Danger    string `json:"danger"`
	Terminal  string `json:"terminal"`
	Message   string `json:"message"`
}

// Materials controls fixed server-side material recipes. It cannot contain CSS.
type Materials struct {
	Canvas   Material `json:"canvas"`
	Sidebar  Material `json:"sidebar"`
	Card     Material `json:"card"`
	Input    Material `json:"input"`
	Terminal Material `json:"terminal"`
	Message  Material `json:"message"`
}

// Material contains bounded typed values used by the CSS generator.
type Material struct {
	Kind    string  `json:"kind"`
	Opacity float64 `json:"opacity"`
	Blur    int     `json:"blur"`
	Radius  int     `json:"radius"`
	Shadow  string  `json:"shadow"`
}

// HomeBackground declares an optional image that is exposed only as the home
// background variable. Scope must be exactly "home" in schema v1.
type HomeBackground struct {
	Path  string `json:"path"`
	Scope string `json:"scope"`
}

// ParseManifest strictly decodes and validates one schemaVersion=1 manifest.
func ParseManifest(data []byte) (Manifest, error) {
	if len(data) == 0 {
		return Manifest{}, errors.New("theme manifest is empty")
	}
	if len(data) > MaxManifestBytes {
		return Manifest{}, fmt.Errorf("theme manifest exceeds %d bytes", MaxManifestBytes)
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return Manifest{}, errors.New("theme manifest must be valid UTF-8 without NUL bytes")
	}
	if err := rejectDuplicateJSONKeys(data); err != nil {
		return Manifest{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode theme manifest: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return Manifest{}, errors.New("theme manifest must contain exactly one JSON object")
		}
		return Manifest{}, fmt.Errorf("decode theme manifest: %w", err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// ReadManifest reads a bounded manifest stream and validates it strictly.
func ReadManifest(reader io.Reader) (Manifest, error) {
	if reader == nil {
		return Manifest{}, errors.New("theme manifest reader is required")
	}
	data, err := io.ReadAll(io.LimitReader(reader, MaxManifestBytes+1))
	if err != nil {
		return Manifest{}, fmt.Errorf("read theme manifest: %w", err)
	}
	return ParseManifest(data)
}

// LoadManifest reads a manifest from a regular file.
func LoadManifest(filename string) (Manifest, error) {
	file, err := os.Open(filename)
	if err != nil {
		return Manifest{}, fmt.Errorf("open theme manifest: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Manifest{}, fmt.Errorf("stat theme manifest: %w", err)
	}
	if !info.Mode().IsRegular() {
		return Manifest{}, errors.New("theme manifest must be a regular file")
	}
	return ReadManifest(file)
}

// ValidateManifest validates a programmatically constructed manifest.
func ValidateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != SchemaVersionV1 {
		return fmt.Errorf("theme schemaVersion must be %d", SchemaVersionV1)
	}
	if !validID(manifest.ID) {
		return errors.New("theme id must be 1-63 lowercase ASCII letters, digits, or interior hyphens")
	}
	if err := validateText("name", manifest.Name, 120, true); err != nil {
		return err
	}
	if !validVersion(manifest.Version) {
		return errors.New("theme version must be 1-64 safe ASCII characters")
	}
	if err := validateText("description", manifest.Description, 1000, true); err != nil {
		return err
	}
	if err := validateText("author", manifest.Author, 120, true); err != nil {
		return err
	}
	if manifest.ColorScheme != ColorSchemeLight && manifest.ColorScheme != ColorSchemeDark {
		return errors.New("theme colorScheme must be light or dark")
	}
	colors := []struct {
		name  string
		value string
	}{
		{"canvas", manifest.Tokens.Canvas}, {"sidebar", manifest.Tokens.Sidebar},
		{"card", manifest.Tokens.Card}, {"input", manifest.Tokens.Input},
		{"text", manifest.Tokens.Text}, {"muted", manifest.Tokens.Muted},
		{"border", manifest.Tokens.Border}, {"primary", manifest.Tokens.Primary},
		{"secondary", manifest.Tokens.Secondary}, {"danger", manifest.Tokens.Danger},
		{"terminal", manifest.Tokens.Terminal}, {"message", manifest.Tokens.Message},
	}
	for _, color := range colors {
		if !validColor(color.value) {
			return fmt.Errorf("theme token %s must be a #RGB, #RGBA, #RRGGBB, or #RRGGBBAA color", color.name)
		}
	}
	materials := []struct {
		name  string
		value Material
	}{
		{"canvas", manifest.Materials.Canvas}, {"sidebar", manifest.Materials.Sidebar},
		{"card", manifest.Materials.Card}, {"input", manifest.Materials.Input},
		{"terminal", manifest.Materials.Terminal}, {"message", manifest.Materials.Message},
	}
	for _, material := range materials {
		if err := validateMaterial(material.name, material.value); err != nil {
			return err
		}
	}
	seen := make(map[string]struct{}, 2)
	if manifest.Preview != "" {
		resource, err := normalizeResourcePath(manifest.Preview)
		if err != nil {
			return fmt.Errorf("theme preview: %w", err)
		}
		if resource != manifest.Preview {
			return errors.New("theme preview path must already be normalized")
		}
		seen[strings.ToLower(resource)] = struct{}{}
	}
	if manifest.HomeBackground != nil {
		if manifest.HomeBackground.Scope != "home" {
			return errors.New("theme homeBackground scope must be home")
		}
		resource, err := normalizeResourcePath(manifest.HomeBackground.Path)
		if err != nil {
			return fmt.Errorf("theme homeBackground: %w", err)
		}
		if resource != manifest.HomeBackground.Path {
			return errors.New("theme homeBackground path must already be normalized")
		}
		key := strings.ToLower(resource)
		if _, duplicate := seen[key]; duplicate {
			return errors.New("theme preview and homeBackground must use distinct paths")
		}
	}
	return nil
}

func rejectDuplicateJSONKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := walkJSONValue(decoder); err != nil {
		return fmt.Errorf("decode theme manifest: %w", err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return errors.New("theme manifest must contain exactly one JSON object")
		}
		return fmt.Errorf("decode theme manifest: %w", err)
	}
	return nil
}

func walkJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("JSON object key must be a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate JSON field %q", key)
			}
			seen[key] = struct{}{}
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil {
			return err
		}
		if closing != json.Delim('}') {
			return errors.New("invalid JSON object closing delimiter")
		}
	case '[':
		for decoder.More() {
			if err := walkJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil {
			return err
		}
		if closing != json.Delim(']') {
			return errors.New("invalid JSON array closing delimiter")
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	return nil
}

func validateMaterial(name string, material Material) error {
	switch material.Kind {
	case MaterialSolid, MaterialTranslucent, MaterialGlass:
	default:
		return fmt.Errorf("theme material %s kind must be solid, translucent, or glass", name)
	}
	if material.Opacity < 0 || material.Opacity > 1 {
		return fmt.Errorf("theme material %s opacity must be between 0 and 1", name)
	}
	if material.Blur < 0 || material.Blur > 64 {
		return fmt.Errorf("theme material %s blur must be between 0 and 64", name)
	}
	if material.Radius < 0 || material.Radius > 48 {
		return fmt.Errorf("theme material %s radius must be between 0 and 48", name)
	}
	switch material.Shadow {
	case ShadowNone, ShadowSoft, ShadowMedium, ShadowStrong:
	default:
		return fmt.Errorf("theme material %s shadow must be none, soft, medium, or strong", name)
	}
	return nil
}

func validateText(name, value string, maxBytes int, required bool) error {
	if required && strings.TrimSpace(value) == "" {
		return fmt.Errorf("theme %s is required", name)
	}
	if value != strings.TrimSpace(value) || len(value) > maxBytes || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
		return fmt.Errorf("theme %s is invalid", name)
	}
	for _, char := range value {
		if char < 0x20 && char != '\n' && char != '\t' {
			return fmt.Errorf("theme %s contains a control character", name)
		}
	}
	return nil
}

func validID(value string) bool {
	if len(value) == 0 || len(value) > 63 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	lastDash := false
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= '0' && char <= '9':
			lastDash = false
		case char == '-' && !lastDash:
			lastDash = true
		default:
			return false
		}
	}
	return true
}

func validVersion(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for index, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || (index > 0 && strings.ContainsRune("._+-", char)) {
			continue
		}
		return false
	}
	return true
}

func validColor(value string) bool {
	if len(value) != 4 && len(value) != 5 && len(value) != 7 && len(value) != 9 {
		return false
	}
	if value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return false
	}
	return true
}

func normalizeResourcePath(value string) (string, error) {
	if value == "" || len(value) > 240 || strings.Contains(value, "\\") || strings.HasPrefix(value, "/") || path.IsAbs(value) {
		return "", errors.New("resource path must be a bounded relative slash path")
	}
	clean := path.Clean(value)
	if clean != value || clean == "." || clean == ".." {
		return "", errors.New("resource path must not contain empty, dot, or parent components")
	}
	components := strings.Split(clean, "/")
	for _, component := range components {
		if component == "" || component == "." || component == ".." || strings.HasPrefix(component, ".") || len(component) > 100 {
			return "", errors.New("resource path contains an unsafe component")
		}
		for _, char := range component {
			if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._-", char) {
				continue
			}
			return "", errors.New("resource path components may contain only ASCII letters, digits, dot, underscore, and hyphen")
		}
	}
	extension := strings.ToLower(path.Ext(clean))
	if extension != ".png" && extension != ".jpg" && extension != ".jpeg" && extension != ".webp" {
		return "", errors.New("resource extension must be png, jpg, jpeg, or webp")
	}
	return clean, nil
}

func declaredResourcePaths(manifest Manifest) []string {
	paths := make([]string, 0, 2)
	if manifest.Preview != "" {
		paths = append(paths, manifest.Preview)
	}
	if manifest.HomeBackground != nil {
		paths = append(paths, manifest.HomeBackground.Path)
	}
	return paths
}
