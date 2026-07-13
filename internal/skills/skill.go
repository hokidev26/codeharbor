// Package skills parses and deterministically scans prompt-template skills.
package skills

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxContentBytes     = 128 * 1024
	MaxNameBytes        = 120
	MaxDescriptionBytes = 500
	MaxPromptBytes      = 128 * 1024

	// ScannerVersion is bumped whenever Scan semantics change. Persisted skills
	// with an older version are revalidated at startup before they can be used.
	ScannerVersion = 1
)

const (
	VerdictSafe    = "safe"
	VerdictReview  = "review"
	VerdictBlocked = "blocked"
)

// Skill is the normalized template persisted by the server. It has no execution
// semantics: callers may only insert Prompt into a chat input.
type Skill struct {
	Name        string
	Command     string
	Description string
	Prompt      string
}

// Finding is a deterministic scanner result. Messages deliberately omit source
// excerpts so preview, audit, and logs do not repeat potential secrets.
type Finding struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// ScanResult contains derived metadata for one normalized skill.
type ScanResult struct {
	Hash     string    `json:"hash"`
	Verdict  string    `json:"verdict"`
	Findings []Finding `json:"findings"`
}

var (
	promptInjectionPattern = regexp.MustCompile(`(?is)\b(?:ignore|disregard|override|bypass)\b.{0,120}\b(?:system|developer|previous|prior)\b.{0,80}\b(?:instruction|rule|prompt|message)s?\b`)
	sensitiveAccessPattern = regexp.MustCompile(`(?is)\b(?:read|cat|print|show|reveal|exfiltrat(?:e|ion)|upload|send|copy|dump)\b.{0,120}(?:\.\s*env\b|credential(?:s|\.json)?\b|private[ _-]?key\b|id_rsa\b)`)
	dangerousShellPattern  = regexp.MustCompile(`(?is)(?:\brm\s+-[a-z]*[rf][a-z]*\b|\brmrf\b|\bsudo\b|\bcurl\b[^\n|]{0,160}\|\s*(?:sh|bash|zsh)\b|\bwget\b[^\n|]{0,160}\|\s*(?:sh|bash|zsh)\b)`)
	networkPattern         = regexp.MustCompile(`(?is)(?:\b(?:curl|wget|invoke-webrequest|fetch)\b|https?://)`)
	autoExecutionPattern   = regexp.MustCompile(`(?is)(?:\bauto(?:matically)?[- ]?(?:run|execute)\b|\b(?:without|skip|bypass)\b.{0,80}\b(?:approval|confirm(?:ation)?|review)\b|\bdo not ask\b)`)
)

// ParseMarkdown accepts only file contents. It never accepts or resolves a file
// path. A small YAML-like frontmatter section is supported without a YAML parser.
func ParseMarkdown(content string) (Skill, error) {
	if err := validateContent(content); err != nil {
		return Skill{}, err
	}
	content = normalizeNewlines(content)
	parsed := Skill{}
	body := content
	if strings.HasPrefix(content, "---\n") {
		lines := strings.Split(content, "\n")
		end := -1
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) == "---" {
				end = i
				break
			}
		}
		if end < 0 {
			return Skill{}, errors.New("skill frontmatter is missing a closing --- line")
		}
		seen := map[string]bool{}
		for _, line := range lines[1:end] {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				return Skill{}, errors.New("skill frontmatter lines must use key: value")
			}
			key = strings.ToLower(strings.TrimSpace(key))
			value = trimSimpleValue(value)
			switch key {
			case "name":
				if seen[key] {
					return Skill{}, errors.New("skill frontmatter has duplicate name")
				}
				parsed.Name = value
				seen[key] = true
			case "description":
				if seen[key] {
					return Skill{}, errors.New("skill frontmatter has duplicate description")
				}
				parsed.Description = value
				seen[key] = true
			case "command":
				if seen[key] {
					return Skill{}, errors.New("skill frontmatter has duplicate command")
				}
				parsed.Command = value
				seen[key] = true
			}
		}
		body = strings.Join(lines[end+1:], "\n")
	}
	parsed.Prompt = body
	return Normalize(parsed)
}

// Normalize validates manual and imported templates and derives omitted metadata
// without widening the accepted command grammar.
func Normalize(input Skill) (Skill, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Prompt = strings.TrimSpace(normalizeNewlines(input.Prompt))
	input.Command = strings.TrimSpace(input.Command)
	if input.Prompt == "" {
		return Skill{}, errors.New("skill prompt is required")
	}
	if !utf8.ValidString(input.Name) || !utf8.ValidString(input.Description) || !utf8.ValidString(input.Prompt) {
		return Skill{}, errors.New("skill fields must be valid UTF-8")
	}
	if strings.ContainsRune(input.Name, 0) || strings.ContainsRune(input.Description, 0) || strings.ContainsRune(input.Prompt, 0) {
		return Skill{}, errors.New("skill fields must not contain NUL bytes")
	}
	if input.Name == "" {
		input.Name = deriveName(input.Prompt)
	}
	if input.Command == "" {
		input.Command = commandFromName(input.Name)
	}
	command, err := normalizeCommand(input.Command)
	if err != nil {
		return Skill{}, err
	}
	input.Command = command
	if input.Name == "" {
		input.Name = strings.TrimPrefix(command, "/")
	}
	if input.Description == "" {
		input.Description = fmt.Sprintf("Prompt template for %s", command)
	}
	if len(input.Name) > MaxNameBytes {
		return Skill{}, fmt.Errorf("skill name exceeds %d bytes", MaxNameBytes)
	}
	if len(input.Description) > MaxDescriptionBytes {
		return Skill{}, fmt.Errorf("skill description exceeds %d bytes", MaxDescriptionBytes)
	}
	if len(input.Prompt) > MaxPromptBytes {
		return Skill{}, fmt.Errorf("skill prompt exceeds %d bytes", MaxPromptBytes)
	}
	return input, nil
}

// Scan performs no I/O, model call, or network activity.
func Scan(skill Skill) ScanResult {
	text := strings.Join([]string{skill.Name, skill.Command, skill.Description, skill.Prompt}, "\n")
	// Restore only explicit runs of single ASCII letters separated by whitespace
	// or punctuation, such as "i.g.n.o.r.e". This avoids broad substring
	// matching that would misclassify ordinary words such as Sudoku or prefetch.
	unobfuscated := unobfuscateASCIIWords(text)
	findings := make([]Finding, 0, 6)
	if matchesScanPattern(promptInjectionPattern, text, unobfuscated) {
		findings = append(findings, Finding{Code: "prompt_injection", Severity: VerdictReview, Message: "Contains instructions to ignore or override higher-priority rules."})
	}
	if matchesScanPattern(sensitiveAccessPattern, text, unobfuscated) {
		findings = append(findings, Finding{Code: "sensitive_file_access", Severity: VerdictBlocked, Message: "Contains instructions to read or expose environment, credential, or private-key material."})
	}
	if matchesScanPattern(dangerousShellPattern, text, unobfuscated) {
		findings = append(findings, Finding{Code: "dangerous_shell", Severity: VerdictReview, Message: "Contains a dangerous shell command pattern."})
	}
	if matchesScanPattern(networkPattern, text, unobfuscated) {
		findings = append(findings, Finding{Code: "network_or_external_url", Severity: VerdictReview, Message: "Contains a network download instruction or external URL."})
	}
	if hasHiddenCharacters(text) {
		findings = append(findings, Finding{Code: "hidden_unicode_or_control", Severity: VerdictReview, Message: "Contains hidden Unicode or non-printing control characters."})
	}
	if matchesScanPattern(autoExecutionPattern, text, unobfuscated) {
		findings = append(findings, Finding{Code: "approval_bypass", Severity: VerdictReview, Message: "Contains automatic-execution or approval-bypass language."})
	}
	verdict := VerdictSafe
	for _, finding := range findings {
		if finding.Severity == VerdictBlocked {
			verdict = VerdictBlocked
			break
		}
		verdict = VerdictReview
	}
	return ScanResult{Hash: Hash(skill), Verdict: verdict, Findings: findings}
}

// Hash returns a stable hash of normalized, persisted template fields.
func Hash(skill Skill) string {
	canonical := "name:" + skill.Name + "\ncommand:" + skill.Command + "\ndescription:" + skill.Description + "\nprompt:\n" + skill.Prompt
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

func validateContent(content string) error {
	if len(content) == 0 {
		return errors.New("skill content is required")
	}
	if len(content) > MaxContentBytes {
		return fmt.Errorf("skill content exceeds %d bytes", MaxContentBytes)
	}
	if !utf8.ValidString(content) {
		return errors.New("skill content must be valid UTF-8")
	}
	if strings.ContainsRune(content, 0) {
		return errors.New("skill content must not contain NUL bytes")
	}
	return nil
}

func normalizeNewlines(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
}

func trimSimpleValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
		return strings.TrimSpace(value[1 : len(value)-1])
	}
	return value
}

func deriveName(prompt string) string {
	for _, line := range strings.Split(prompt, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			name := strings.TrimSpace(strings.TrimLeft(line, "#"))
			if name != "" {
				return name
			}
		}
	}
	return "Imported skill"
}

func commandFromName(name string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			builder.WriteRune(r)
			lastDash = false
		case r == '-' || r == ' ' || r == '\t':
			if builder.Len() > 0 && !lastDash {
				builder.WriteByte('-')
				lastDash = true
			}
		default:
			if builder.Len() > 0 && !lastDash {
				builder.WriteByte('-')
				lastDash = true
			}
		}
	}
	derived := strings.Trim(builder.String(), "-")
	if derived == "" {
		derived = "skill"
	}
	return "/" + derived
}

func normalizeCommand(command string) (string, error) {
	command = strings.TrimSpace(strings.ToLower(command))
	command = strings.TrimPrefix(command, "/")
	if command == "" || len(command) > 63 {
		return "", errors.New("skill command must be 1-63 ASCII characters")
	}
	for i, char := range []byte(command) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			if i == 0 && (char == '-' || char == '_') {
				return "", errors.New("skill command must start with a letter or number")
			}
			continue
		}
		return "", errors.New("skill command may contain only lowercase letters, numbers, - and _")
	}
	return "/" + command, nil
}

func matchesScanPattern(pattern *regexp.Regexp, text, compact string) bool {
	return pattern.MatchString(text) || pattern.MatchString(compact)
}

// unobfuscateASCIIWords collapses only runs such as "i.g.n.o.r.e" or
// "R M - R F". It leaves regular multi-letter words untouched so scanner
// matching remains boundary-sensitive and does not create substring false positives.
func unobfuscateASCIIWords(value string) string {
	var builder strings.Builder
	builder.Grow(len(value))
	for i := 0; i < len(value); {
		if !isASCIIAlpha(value[i]) || (i > 0 && isASCIIAlpha(value[i-1])) {
			builder.WriteByte(value[i])
			i++
			continue
		}
		letters := []byte{value[i]}
		end := i + 1
		cursor := end
		for {
			separatorStart := cursor
			for cursor < len(value) && isASCIIObfuscationSeparator(value[cursor]) {
				cursor++
			}
			if cursor == separatorStart || cursor >= len(value) || !isASCIIAlpha(value[cursor]) {
				break
			}
			if cursor+1 < len(value) && isASCIIAlpha(value[cursor+1]) {
				break
			}
			letters = append(letters, value[cursor])
			end = cursor + 1
			cursor = end
		}
		if len(letters) >= 3 {
			builder.WriteString(strings.ToLower(string(letters)))
			i = end
			continue
		}
		builder.WriteByte(value[i])
		i++
	}
	return builder.String()
}

func isASCIIAlpha(value byte) bool {
	return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
}

func isASCIIObfuscationSeparator(value byte) bool {
	return value == ' ' || value == '\t' || value == '\n' || value == '\r' ||
		(value >= '!' && value <= '/') || (value >= ':' && value <= '@') ||
		(value >= '[' && value <= '`') || (value >= '{' && value <= '~')
}

func hasHiddenCharacters(value string) bool {
	for _, r := range value {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			continue
		case unicode.IsControl(r), unicode.Is(unicode.Cf, r):
			return true
		}
	}
	return false
}
