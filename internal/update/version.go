package update

import (
	"fmt"
	"regexp"
	"strings"
)

var semverPattern = regexp.MustCompile(`^[vV]?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)

type semanticVersion struct {
	major      string
	minor      string
	patch      string
	prerelease []string
	build      string
}

// NormalizeVersion validates SemVer, accepts an optional v prefix, and returns
// the version without that prefix.
func NormalizeVersion(value string) (string, error) {
	return canonicalVersion(value)
}

// IsDevelopmentVersion identifies versions that must never be treated as
// release builds for update availability decisions.
func IsDevelopmentVersion(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" || trimmed == "dev" || trimmed == "devel" || trimmed == "development" || strings.Contains(trimmed, "(devel)") {
		return true
	}
	parsed, err := parseVersion(trimmed)
	if err != nil {
		return true
	}
	for _, identifier := range parsed.prerelease {
		identifier = strings.ToLower(identifier)
		switch identifier {
		case "dev", "devel", "development", "dirty", "local", "snapshot":
			return true
		}
	}
	return false
}

// CompareVersions applies SemVer precedence. Build metadata is ignored.
func CompareVersions(left, right string) (int, error) {
	leftVersion, err := parseVersion(left)
	if err != nil {
		return 0, err
	}
	rightVersion, err := parseVersion(right)
	if err != nil {
		return 0, err
	}
	for _, pair := range [][2]string{
		{leftVersion.major, rightVersion.major},
		{leftVersion.minor, rightVersion.minor},
		{leftVersion.patch, rightVersion.patch},
	} {
		if comparison := compareNumericIdentifier(pair[0], pair[1]); comparison != 0 {
			return comparison, nil
		}
	}
	if len(leftVersion.prerelease) == 0 && len(rightVersion.prerelease) == 0 {
		return 0, nil
	}
	if len(leftVersion.prerelease) == 0 {
		return 1, nil
	}
	if len(rightVersion.prerelease) == 0 {
		return -1, nil
	}
	limit := len(leftVersion.prerelease)
	if len(rightVersion.prerelease) < limit {
		limit = len(rightVersion.prerelease)
	}
	for index := 0; index < limit; index++ {
		leftIdentifier := leftVersion.prerelease[index]
		rightIdentifier := rightVersion.prerelease[index]
		leftNumeric := isNumeric(leftIdentifier)
		rightNumeric := isNumeric(rightIdentifier)
		switch {
		case leftNumeric && rightNumeric:
			if comparison := compareNumericIdentifier(leftIdentifier, rightIdentifier); comparison != 0 {
				return comparison, nil
			}
		case leftNumeric:
			return -1, nil
		case rightNumeric:
			return 1, nil
		default:
			if leftIdentifier < rightIdentifier {
				return -1, nil
			}
			if leftIdentifier > rightIdentifier {
				return 1, nil
			}
		}
	}
	if len(leftVersion.prerelease) < len(rightVersion.prerelease) {
		return -1, nil
	}
	if len(leftVersion.prerelease) > len(rightVersion.prerelease) {
		return 1, nil
	}
	return 0, nil
}

func canonicalVersion(value string) (string, error) {
	parsed, err := parseVersion(value)
	if err != nil {
		return "", err
	}
	canonical := parsed.major + "." + parsed.minor + "." + parsed.patch
	if len(parsed.prerelease) > 0 {
		canonical += "-" + strings.Join(parsed.prerelease, ".")
	}
	if parsed.build != "" {
		canonical += "+" + parsed.build
	}
	return canonical, nil
}

func parseVersion(value string) (semanticVersion, error) {
	value = strings.TrimSpace(value)
	matches := semverPattern.FindStringSubmatch(value)
	if matches == nil {
		return semanticVersion{}, fmt.Errorf("invalid semantic version %q", value)
	}
	parsed := semanticVersion{major: matches[1], minor: matches[2], patch: matches[3], build: matches[5]}
	if matches[4] != "" {
		parsed.prerelease = strings.Split(matches[4], ".")
	}
	return parsed, nil
}

func compareNumericIdentifier(left, right string) int {
	if len(left) < len(right) {
		return -1
	}
	if len(left) > len(right) {
		return 1
	}
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func isNumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
