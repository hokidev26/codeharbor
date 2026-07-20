package themes

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	MaxImageDimension = 8192
	MaxImagePixels    = 32 << 20
)

var (
	ErrNotFound         = errors.New("theme not found")
	ErrConflict         = errors.New("theme already exists")
	ErrBundledProtected = errors.New("bundled theme is protected")
	ErrRevisionMismatch = errors.New("theme revision mismatch")
	ErrInvalidArchive   = errors.New("invalid theme archive")
)

// ImportOptions controls conflict handling. Replace never applies to bundled themes.
type ImportOptions struct {
	Replace bool
}

const (
	SourceBundled = "bundled"
	SourceLocal   = "local"
)

// Theme is handler-ready metadata for a bundled or locally imported theme.
// Manifest remains available to trusted Go callers but is intentionally not
// serialized by list APIs; the public JSON shape is flat and UI-oriented.
type Theme struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	Version       string             `json:"version"`
	Description   string             `json:"description"`
	Author        string             `json:"author"`
	ColorScheme   string             `json:"colorScheme"`
	Source        string             `json:"source"`
	Revision      string             `json:"revision"`
	StylesheetURL string             `json:"stylesheetUrl"`
	PreviewURL    string             `json:"previewUrl,omitempty"`
	Deletable     bool               `json:"deletable"`
	Resources     []ResourceMetadata `json:"resources,omitempty"`
	Capabilities  ThemeCapabilities  `json:"capabilities"`
	Manifest      Manifest           `json:"-"`
	Bundled       bool               `json:"-"`
}

// ResourceMetadata describes a validated image resource and its revisioned URL.
type ResourceMetadata struct {
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	URL         string `json:"url"`
}

// Resource is an opened, revision-checked response body.
type Resource struct {
	io.ReadSeekCloser
	Metadata ResourceMetadata
	ModTime  time.Time
}

// Store manages bundled themes and appHome/themes local themes.
type Store struct {
	mu      sync.RWMutex
	root    string
	bundled map[string]bundledTheme
}

type bundledTheme struct {
	manifest  Manifest
	resources map[string][]byte
}

// NewStore creates the private theme root beneath appHome.
func NewStore(appHome string) (*Store, error) {
	if strings.TrimSpace(appHome) == "" {
		return nil, errors.New("app home is required")
	}
	absoluteHome, err := filepath.Abs(appHome)
	if err != nil {
		return nil, fmt.Errorf("resolve app home: %w", err)
	}
	if err := os.MkdirAll(absoluteHome, 0o700); err != nil {
		return nil, fmt.Errorf("create app home: %w", err)
	}
	realHome, err := filepath.EvalSymlinks(absoluteHome)
	if err != nil {
		return nil, fmt.Errorf("resolve app home symlinks: %w", err)
	}
	root := filepath.Join(realHome, "themes")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create theme root: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, fmt.Errorf("protect theme root: %w", err)
	}
	if _, err := secureDirectory(root); err != nil {
		return nil, err
	}
	return &Store{root: root, bundled: builtInThemes()}, nil
}

// New is an alias for NewStore.
func New(appHome string) (*Store, error) { return NewStore(appHome) }

// Root returns the physical local theme root.
func (store *Store) Root() string {
	if store == nil {
		return ""
	}
	return store.root
}

// List returns bundled and active local themes sorted by ID.
func (store *Store) List() ([]Theme, error) {
	if store == nil {
		return nil, errors.New("theme store is unavailable")
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.listLocked()
}

// Get returns one bundled or active local theme.
func (store *Store) Get(id string) (Theme, error) {
	if store == nil {
		return Theme{}, errors.New("theme store is unavailable")
	}
	if !validID(id) {
		return Theme{}, ErrNotFound
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	if bundled, ok := store.bundled[id]; ok {
		return materializeBundled(bundled)
	}
	return store.loadActiveLocal(id)
}

// GetRevision returns a content-addressed bundled or local theme revision.
func (store *Store) GetRevision(id, revision string) (Theme, error) {
	if store == nil {
		return Theme{}, errors.New("theme store is unavailable")
	}
	if !validID(id) || !validRevision(revision) {
		return Theme{}, ErrNotFound
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	if bundled, ok := store.bundled[id]; ok {
		theme, err := materializeBundled(bundled)
		if err != nil {
			return Theme{}, err
		}
		if theme.Revision != revision {
			return Theme{}, ErrRevisionMismatch
		}
		return theme, nil
	}
	return store.loadLocalRevision(id, revision)
}

// CSS returns validated server-generated CSS for the active installed theme.
func (store *Store) CSS(id string) (string, error) {
	theme, err := store.Get(id)
	if err != nil {
		return "", err
	}
	return GenerateCSS(theme)
}

// CSSForRevision returns server-generated CSS bound to a revisioned stylesheet URL.
func (store *Store) CSSForRevision(id, revision string) (string, error) {
	theme, err := store.GetRevision(id, revision)
	if err != nil {
		return "", err
	}
	return GenerateCSS(theme)
}

// Delete removes a local theme atomically from the active namespace.
func (store *Store) Delete(id string) error {
	if store == nil {
		return errors.New("theme store is unavailable")
	}
	if !validID(id) {
		return ErrNotFound
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, bundled := store.bundled[id]; bundled {
		return fmt.Errorf("%w: %s", ErrBundledProtected, id)
	}
	if _, err := secureDirectory(store.root); err != nil {
		return err
	}
	themeDir := filepath.Join(store.root, id)
	info, err := os.Lstat(themeDir)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("inspect theme: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("local theme path is not a safe directory")
	}
	trash, err := os.MkdirTemp(store.root, ".delete-*")
	if err != nil {
		return fmt.Errorf("prepare theme deletion: %w", err)
	}
	if err := os.Remove(trash); err != nil {
		return fmt.Errorf("prepare theme deletion: %w", err)
	}
	if err := os.Rename(themeDir, trash); err != nil {
		return fmt.Errorf("remove theme from active namespace: %w", err)
	}
	if err := os.RemoveAll(trash); err != nil {
		return fmt.Errorf("clean deleted theme: %w", err)
	}
	return nil
}

// OpenResource opens an installed image after revalidating its path, symlink
// boundary, declared MIME type, and complete content revision.
func (store *Store) OpenResource(id, revision, resourcePath string) (*Resource, error) {
	if store == nil {
		return nil, errors.New("theme store is unavailable")
	}
	if !validID(id) || !validRevision(revision) {
		return nil, ErrNotFound
	}
	normalized, err := normalizeResourcePath(resourcePath)
	if err != nil || normalized != resourcePath {
		return nil, ErrNotFound
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	if bundled, ok := store.bundled[id]; ok {
		theme, err := materializeBundled(bundled)
		if err != nil {
			return nil, err
		}
		if theme.Revision != revision {
			return nil, ErrRevisionMismatch
		}
		data, ok := bundled.resources[resourcePath]
		if !ok || !resourceDeclared(theme.Manifest, resourcePath) {
			return nil, ErrNotFound
		}
		contentType, err := validateImageBytes(resourcePath, data)
		if err != nil {
			return nil, err
		}
		metadata := resourceMetadata(id, revision, resourcePath, contentType, int64(len(data)))
		return &Resource{ReadSeekCloser: &memoryReadSeekCloser{Reader: bytes.NewReader(data)}, Metadata: metadata}, nil
	}
	versionDir, err := store.secureVersionDirectory(id, revision)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	manifest, err := loadManifestSecure(versionDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if manifest.ID != id || !resourceDeclared(manifest, resourcePath) {
		return nil, ErrNotFound
	}
	file, info, err := openRegularWithin(versionDir, resourcePath)
	if err != nil {
		return nil, err
	}
	data, err := readBoundedImage(file)
	file.Close()
	if err != nil {
		return nil, fmt.Errorf("read theme resource: %w", err)
	}
	contentType, err := validateImageBytes(resourcePath, data)
	if err != nil {
		return nil, err
	}
	actualRevision, err := hashThemeDirectory(versionDir, manifest, resourcePath, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if actualRevision != revision {
		return nil, ErrRevisionMismatch
	}
	metadata := resourceMetadata(id, revision, resourcePath, contentType, int64(len(data)))
	return &Resource{ReadSeekCloser: &memoryReadSeekCloser{Reader: bytes.NewReader(data)}, Metadata: metadata, ModTime: info.ModTime()}, nil
}

func (store *Store) listLocked() ([]Theme, error) {
	if _, err := secureDirectory(store.root); err != nil {
		return nil, err
	}
	result := make([]Theme, 0, len(store.bundled)+4)
	for _, bundled := range store.bundled {
		theme, err := materializeBundled(bundled)
		if err != nil {
			return nil, err
		}
		result = append(result, theme)
	}
	entries, err := os.ReadDir(store.root)
	if err != nil {
		return nil, fmt.Errorf("list local themes: %w", err)
	}
	for _, entry := range entries {
		id := entry.Name()
		if !validID(id) {
			continue
		}
		if _, bundled := store.bundled[id]; bundled {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("inspect local theme %s: %w", id, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, fmt.Errorf("local theme %s is not a safe directory", id)
		}
		theme, err := store.loadActiveLocal(id)
		if err != nil {
			return nil, fmt.Errorf("load local theme %s: %w", id, err)
		}
		result = append(result, theme)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Manifest.ID < result[j].Manifest.ID })
	return result, nil
}

func (store *Store) loadActiveLocal(id string) (Theme, error) {
	root, err := secureDirectory(store.root)
	if err != nil {
		return Theme{}, err
	}
	themeDir, err := secureDirectory(filepath.Join(store.root, id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Theme{}, ErrNotFound
		}
		return Theme{}, err
	}
	if !pathWithin(root, themeDir) {
		return Theme{}, errors.New("theme directory escapes the theme root")
	}
	currentFile, _, err := openRegularWithin(themeDir, "current")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Theme{}, ErrNotFound
		}
		return Theme{}, err
	}
	currentBytes, err := io.ReadAll(io.LimitReader(currentFile, 65))
	currentFile.Close()
	if err != nil {
		return Theme{}, fmt.Errorf("read active theme revision: %w", err)
	}
	revision := strings.TrimSpace(string(currentBytes))
	if !validRevision(revision) {
		return Theme{}, errors.New("active theme revision is invalid")
	}
	return store.loadLocalRevision(id, revision)
}

func (store *Store) loadLocalRevision(id, revision string) (Theme, error) {
	versionDir, err := store.secureVersionDirectory(id, revision)
	if errors.Is(err, os.ErrNotExist) {
		return Theme{}, ErrNotFound
	}
	if err != nil {
		return Theme{}, err
	}
	manifest, err := loadManifestSecure(versionDir)
	if err != nil {
		return Theme{}, err
	}
	if manifest.ID != id {
		return Theme{}, errors.New("theme id does not match its directory")
	}
	actualRevision, err := hashThemeDirectory(versionDir, manifest, "", nil)
	if err != nil {
		return Theme{}, err
	}
	if actualRevision != revision {
		return Theme{}, ErrRevisionMismatch
	}
	resources, err := metadataForDirectory(id, revision, versionDir, manifest)
	if err != nil {
		return Theme{}, err
	}
	return newThemeMetadata(manifest, revision, false, resources), nil
}

func materializeBundled(bundled bundledTheme) (Theme, error) {
	if err := ValidateManifest(bundled.manifest); err != nil {
		return Theme{}, fmt.Errorf("invalid bundled theme: %w", err)
	}
	revision, err := hashThemeContent(bundled.manifest, bundled.resources, nil)
	if err != nil {
		return Theme{}, err
	}
	paths := declaredResourcePaths(bundled.manifest)
	resources := make([]ResourceMetadata, 0, len(paths))
	for _, resourcePath := range paths {
		data, ok := bundled.resources[resourcePath]
		if !ok {
			return Theme{}, fmt.Errorf("bundled theme resource %s is missing", resourcePath)
		}
		contentType, err := validateImageBytes(resourcePath, data)
		if err != nil {
			return Theme{}, err
		}
		resources = append(resources, resourceMetadata(bundled.manifest.ID, revision, resourcePath, contentType, int64(len(data))))
	}
	return newThemeMetadata(bundled.manifest, revision, true, resources), nil
}

func newThemeMetadata(manifest Manifest, revision string, bundled bool, resources []ResourceMetadata) Theme {
	source := SourceLocal
	if bundled {
		source = SourceBundled
	}
	theme := Theme{
		ID: manifest.ID, Name: manifest.Name, Version: manifest.Version,
		Description: manifest.Description, Author: manifest.Author, ColorScheme: manifest.ColorScheme,
		Source: source, Revision: revision, Deletable: !bundled, Manifest: manifest,
		Capabilities: capabilitiesForManifest(manifest), Bundled: bundled, Resources: resources,
		StylesheetURL: "/themes/" + manifest.ID + "/" + revision + "/theme.css",
	}
	if manifest.Preview != "" {
		theme.PreviewURL = "/themes/" + manifest.ID + "/" + revision + "/" + escapeResourcePath(manifest.Preview)
	}
	return theme
}

func metadataForDirectory(id, revision, directory string, manifest Manifest) ([]ResourceMetadata, error) {
	paths := declaredResourcePaths(manifest)
	sort.Strings(paths)
	resources := make([]ResourceMetadata, 0, len(paths))
	for _, resourcePath := range paths {
		file, info, err := openRegularWithin(directory, resourcePath)
		if err != nil {
			return nil, err
		}
		data, readErr := readBoundedImage(file)
		file.Close()
		if readErr != nil {
			return nil, fmt.Errorf("inspect theme resource: %w", readErr)
		}
		contentType, err := validateImageBytes(resourcePath, data)
		if err != nil {
			return nil, err
		}
		resources = append(resources, resourceMetadata(id, revision, resourcePath, contentType, info.Size()))
	}
	return resources, nil
}

func resourceMetadata(id, revision, resourcePath, contentType string, size int64) ResourceMetadata {
	return ResourceMetadata{
		Path: resourcePath, ContentType: contentType, Size: size,
		URL: "/themes/" + id + "/" + revision + "/" + escapeResourcePath(resourcePath),
	}
}

func resourceDeclared(manifest Manifest, resourcePath string) bool {
	for _, declared := range declaredResourcePaths(manifest) {
		if declared == resourcePath {
			return true
		}
	}
	return false
}

func loadManifestSecure(directory string) (Manifest, error) {
	file, _, err := openRegularWithin(directory, ManifestFilename)
	if err != nil {
		return Manifest{}, err
	}
	defer file.Close()
	return ReadManifest(file)
}

func hashThemeDirectory(directory string, manifest Manifest, openedPath string, opened io.ReadSeeker) (string, error) {
	currentManifest, err := loadManifestSecure(directory)
	if err != nil {
		return "", err
	}
	if !reflect.DeepEqual(currentManifest, manifest) {
		return "", ErrRevisionMismatch
	}
	manifest = currentManifest
	resources := make(map[string]io.Reader, len(declaredResourcePaths(manifest))+1)
	closers := make([]io.Closer, 0, len(resources))
	defer func() {
		for _, closer := range closers {
			_ = closer.Close()
		}
	}()
	for _, resourcePath := range declaredResourcePaths(manifest) {
		if resourcePath == openedPath && opened != nil {
			if _, err := opened.Seek(0, io.SeekStart); err != nil {
				return "", err
			}
			resources[resourcePath] = opened
			continue
		}
		file, _, err := openRegularWithin(directory, resourcePath)
		if err != nil {
			return "", err
		}
		resources[resourcePath] = file
		closers = append(closers, file)
	}
	licensePath := filepath.Join(directory, LicenseFilename)
	if info, err := os.Lstat(licensePath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", errors.New("theme license must be a regular file")
		}
		file, _, err := openRegularWithin(directory, LicenseFilename)
		if err != nil {
			return "", err
		}
		resources[LicenseFilename] = file
		closers = append(closers, file)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return hashThemeReaders(manifest, resources)
}

func hashThemeContent(manifest Manifest, resources map[string][]byte, license []byte) (string, error) {
	readers := make(map[string]io.Reader, len(resources)+1)
	for resourcePath, data := range resources {
		readers[resourcePath] = bytes.NewReader(data)
	}
	if license != nil {
		readers[LicenseFilename] = bytes.NewReader(license)
	}
	return hashThemeReaders(manifest, readers)
}

func hashThemeReaders(manifest Manifest, readers map[string]io.Reader) (string, error) {
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return "", fmt.Errorf("encode theme manifest: %w", err)
	}
	hash := sha256.New()
	writeHashPart(hash, ManifestFilename, canonical)
	paths := make([]string, 0, len(readers))
	for resourcePath := range readers {
		paths = append(paths, resourcePath)
	}
	sort.Strings(paths)
	for _, resourcePath := range paths {
		if err := writeHashReader(hash, resourcePath, readers[resourcePath]); err != nil {
			return "", fmt.Errorf("hash theme resource %s: %w", resourcePath, err)
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeHashPart(writer io.Writer, name string, data []byte) {
	_ = binary.Write(writer, binary.BigEndian, uint64(len(name)))
	_, _ = io.WriteString(writer, name)
	_ = binary.Write(writer, binary.BigEndian, uint64(len(data)))
	_, _ = writer.Write(data)
}

func writeHashReader(hash io.Writer, name string, reader io.Reader) error {
	var data bytes.Buffer
	if _, err := io.Copy(&data, reader); err != nil {
		return err
	}
	writeHashPart(hash, name, data.Bytes())
	return nil
}

func validRevision(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func readBoundedImage(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, MaxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxImageBytes {
		return nil, fmt.Errorf("image exceeds %d bytes", MaxImageBytes)
	}
	return data, nil
}

// ImageDetails is the validated metadata shared by theme and appearance images.
type ImageDetails struct {
	ContentType string
	Width       int
	Height      int
}

// ValidateImageDetails validates an allowed PNG, JPEG, or WebP image and returns
// its MIME type and dimensions. Both theme archives and appearance assets use
// this entrypoint so they enforce identical byte, format, and pixel limits.
func ValidateImageDetails(resourcePath string, data []byte) (ImageDetails, error) {
	contentType := httpDetectContentType(data)
	extension := strings.ToLower(filepath.Ext(resourcePath))
	expected := ""
	switch extension {
	case ".png":
		expected = "image/png"
	case ".jpg", ".jpeg":
		expected = "image/jpeg"
	case ".webp":
		expected = "image/webp"
	}
	if expected == "" || contentType != expected {
		return ImageDetails{}, fmt.Errorf("theme resource %s content does not match its allowed image extension", resourcePath)
	}
	var width, height int
	if expected == "image/webp" {
		var err error
		width, height, err = webPDimensions(data)
		if err != nil {
			return ImageDetails{}, fmt.Errorf("theme resource %s is not a structurally valid WebP image: %w", resourcePath, err)
		}
	} else {
		configuration, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || configuration.Width <= 0 || configuration.Height <= 0 {
			return ImageDetails{}, fmt.Errorf("theme resource %s is not a structurally valid image", resourcePath)
		}
		if (expected == "image/png" && format != "png") || (expected == "image/jpeg" && format != "jpeg") {
			return ImageDetails{}, fmt.Errorf("theme resource %s decoded format does not match its extension", resourcePath)
		}
		width, height = configuration.Width, configuration.Height
	}
	if width > MaxImageDimension || height > MaxImageDimension || int64(width)*int64(height) > MaxImagePixels {
		return ImageDetails{}, fmt.Errorf("theme resource %s dimensions %dx%d exceed safe limits", resourcePath, width, height)
	}
	return ImageDetails{ContentType: expected, Width: width, Height: height}, nil
}

// ValidateImageBytes preserves the original MIME-only validation API.
func ValidateImageBytes(resourcePath string, data []byte) (string, error) {
	details, err := ValidateImageDetails(resourcePath, data)
	return details.ContentType, err
}

func validateImageBytes(resourcePath string, data []byte) (string, error) {
	return ValidateImageBytes(resourcePath, data)
}

func webPDimensions(data []byte) (int, int, error) {
	if len(data) < 20 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0, errors.New("missing RIFF/WEBP header")
	}
	declared := uint64(binary.LittleEndian.Uint32(data[4:8])) + 8
	if declared != uint64(len(data)) {
		return 0, 0, errors.New("RIFF length does not match content")
	}
	var canvasWidth, canvasHeight, frameWidth, frameHeight int
	offset := 12
	for offset+8 <= len(data) {
		kind := string(data[offset : offset+4])
		size64 := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		if size64 > uint64(len(data)-start) {
			return 0, 0, errors.New("invalid WebP chunk length")
		}
		end := start + int(size64)
		chunk := data[start:end]
		switch kind {
		case "VP8X":
			if len(chunk) < 10 {
				return 0, 0, errors.New("short VP8X chunk")
			}
			canvasWidth = 1 + int(chunk[4]) + int(chunk[5])<<8 + int(chunk[6])<<16
			canvasHeight = 1 + int(chunk[7]) + int(chunk[8])<<8 + int(chunk[9])<<16
		case "VP8 ":
			if len(chunk) < 10 || chunk[3] != 0x9d || chunk[4] != 0x01 || chunk[5] != 0x2a {
				return 0, 0, errors.New("invalid VP8 frame header")
			}
			frameWidth = int(binary.LittleEndian.Uint16(chunk[6:8]) & 0x3fff)
			frameHeight = int(binary.LittleEndian.Uint16(chunk[8:10]) & 0x3fff)
		case "VP8L":
			if len(chunk) < 5 || chunk[0] != 0x2f {
				return 0, 0, errors.New("invalid VP8L frame header")
			}
			bits := binary.LittleEndian.Uint32(chunk[1:5])
			frameWidth = int(bits&0x3fff) + 1
			frameHeight = int((bits>>14)&0x3fff) + 1
		}
		offset = end
		if size64%2 != 0 {
			offset++
		}
	}
	if offset != len(data) {
		return 0, 0, errors.New("truncated WebP chunk header or padding")
	}
	if frameWidth <= 0 || frameHeight <= 0 {
		return 0, 0, errors.New("missing VP8 image chunk")
	}
	if canvasWidth > 0 && canvasHeight > 0 {
		return canvasWidth, canvasHeight, nil
	}
	return frameWidth, frameHeight, nil
}

func httpDetectContentType(data []byte) string {
	// Extension lookup is not sufficient because archive content is untrusted.
	return http.DetectContentType(data)
}

func (store *Store) secureVersionDirectory(id, revision string) (string, error) {
	root, err := secureDirectory(store.root)
	if err != nil {
		return "", err
	}
	themeDir, err := secureDirectory(filepath.Join(store.root, id))
	if err != nil {
		return "", err
	}
	if !pathWithin(root, themeDir) {
		return "", errors.New("theme directory escapes the theme root")
	}
	versionDir, err := secureDirectory(filepath.Join(themeDir, revision))
	if err != nil {
		return "", err
	}
	if !pathWithin(themeDir, versionDir) {
		return "", errors.New("theme revision escapes its theme directory")
	}
	return versionDir, nil
}

func secureDirectory(directory string) (string, error) {
	info, err := os.Lstat(directory)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", errors.New("theme path is not a safe directory")
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", err
	}
	return resolved, nil
}

func openRegularWithin(base, relative string) (*os.File, fs.FileInfo, error) {
	if relative == "" || filepath.IsAbs(relative) || filepath.VolumeName(relative) != "" || strings.Contains(relative, "\\") {
		return nil, nil, errors.New("theme file path is invalid")
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil, nil, errors.New("theme file path escapes its root")
	}
	resolvedBase, err := secureDirectory(base)
	if err != nil {
		return nil, nil, err
	}
	cursor := resolvedBase
	components := strings.Split(filepath.ToSlash(relative), "/")
	for index, component := range components {
		if component == "" || component == "." || component == ".." {
			return nil, nil, errors.New("theme file path contains an unsafe component")
		}
		cursor = filepath.Join(cursor, component)
		info, err := os.Lstat(cursor)
		if err != nil {
			return nil, nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, nil, errors.New("theme file path contains a symlink")
		}
		if index < len(components)-1 && !info.IsDir() {
			return nil, nil, errors.New("theme file parent is not a directory")
		}
	}
	resolved, err := filepath.EvalSymlinks(cursor)
	if err != nil {
		return nil, nil, err
	}
	if !pathWithin(resolvedBase, resolved) {
		return nil, nil, errors.New("theme file escapes its root")
	}
	file, err := os.Open(resolved)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	lstat, err := os.Lstat(resolved)
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || lstat.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, lstat) {
		file.Close()
		return nil, nil, errors.New("theme file must be a stable regular file")
	}
	return file, info, nil
}

func pathWithin(base, target string) bool {
	relative, err := filepath.Rel(base, target)
	return err == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

type memoryReadSeekCloser struct {
	*bytes.Reader
}

func (reader *memoryReadSeekCloser) Close() error { return nil }
