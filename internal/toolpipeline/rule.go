package toolpipeline

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxRuleBytes         = 4 * 1024
	maxRuleOperations    = 16
	maxRegexBytes        = 1024
	maxRequestedLines    = 1000
	maxCutFields         = 32
	maxCutFieldIndex     = 64
	maxIntermediateBytes = 4 * 1024 * 1024
)

type parsedRule struct {
	aliases    []string
	operations []pipelineOperation
	normalized string
}

type pipelineOperation struct {
	kind       string
	regex      *regexp.Regexp
	invert     bool
	count      int
	reverse    bool
	delimiter  string
	fieldOrder []int
}

func parseRule(rule string) (parsedRule, error) {
	rule = strings.TrimSpace(rule)
	if len(rule) > maxRuleBytes {
		return parsedRule{}, errors.New("pipeline_rule_invalid: rule exceeds 4096 bytes")
	}
	if rule == "" {
		return parsedRule{}, nil
	}
	segments, err := splitRulePipeline(rule)
	if err != nil {
		return parsedRule{}, fmt.Errorf("pipeline_rule_invalid: %w", err)
	}
	if len(segments) > maxRuleOperations+1 {
		return parsedRule{}, errors.New("pipeline_rule_invalid: rule has too many operations")
	}
	parsed := parsedRule{normalized: strings.Join(segments, " | ")}
	for index, segment := range segments {
		tokens, tokenErr := tokenizeRuleSegment(segment)
		if tokenErr != nil {
			return parsedRule{}, fmt.Errorf("pipeline_rule_invalid: %w", tokenErr)
		}
		if len(tokens) == 0 {
			return parsedRule{}, errors.New("pipeline_rule_invalid: empty operation")
		}
		command := strings.ToLower(tokens[0])
		switch command {
		case "from":
			if index != 0 || len(parsed.aliases) > 0 {
				return parsedRule{}, errors.New("pipeline_rule_invalid: from must be the first operation")
			}
			if len(tokens) < 2 {
				return parsedRule{}, errors.New("pipeline_rule_invalid: from requires at least one alias")
			}
			for _, alias := range tokens[1:] {
				if !validAlias(alias) {
					return parsedRule{}, fmt.Errorf("pipeline_rule_invalid: invalid alias %q", alias)
				}
				parsed.aliases = append(parsed.aliases, alias)
			}
		case "cat":
			if len(tokens) != 1 {
				return parsedRule{}, errors.New("pipeline_rule_invalid: cat accepts no arguments")
			}
			parsed.operations = append(parsed.operations, pipelineOperation{kind: "cat"})
		case "grep":
			op, parseErr := parseGrepOperation(tokens[1:])
			if parseErr != nil {
				return parsedRule{}, parseErr
			}
			parsed.operations = append(parsed.operations, op)
		case "head", "tail":
			if len(tokens) != 3 || tokens[1] != "-n" {
				return parsedRule{}, fmt.Errorf("pipeline_rule_invalid: %s requires -n N", command)
			}
			count, parseErr := strconv.Atoi(tokens[2])
			if parseErr != nil || count < 0 || count > maxRequestedLines {
				return parsedRule{}, fmt.Errorf("pipeline_rule_invalid: %s line count must be between 0 and %d", command, maxRequestedLines)
			}
			parsed.operations = append(parsed.operations, pipelineOperation{kind: command, count: count})
		case "sort":
			if len(tokens) > 2 || len(tokens) == 2 && tokens[1] != "-r" {
				return parsedRule{}, errors.New("pipeline_rule_invalid: sort only supports -r")
			}
			parsed.operations = append(parsed.operations, pipelineOperation{kind: "sort", reverse: len(tokens) == 2})
		case "uniq":
			if len(tokens) != 1 {
				return parsedRule{}, errors.New("pipeline_rule_invalid: uniq accepts no arguments")
			}
			parsed.operations = append(parsed.operations, pipelineOperation{kind: "uniq"})
		case "cut":
			op, parseErr := parseCutOperation(tokens[1:])
			if parseErr != nil {
				return parsedRule{}, parseErr
			}
			parsed.operations = append(parsed.operations, op)
		default:
			return parsedRule{}, fmt.Errorf("pipeline_operation_not_allowed: %s", command)
		}
	}
	if len(parsed.operations) > maxRuleOperations {
		return parsedRule{}, errors.New("pipeline_rule_invalid: rule has too many operations")
	}
	return parsed, nil
}

func parseGrepOperation(args []string) (pipelineOperation, error) {
	caseInsensitive := false
	invert := false
	pattern := ""
	for _, arg := range args {
		switch arg {
		case "-i":
			caseInsensitive = true
		case "-v":
			invert = true
		default:
			if strings.HasPrefix(arg, "-") && pattern == "" {
				return pipelineOperation{}, fmt.Errorf("pipeline_rule_invalid: grep option %s is not supported", arg)
			}
			if pattern != "" {
				return pipelineOperation{}, errors.New("pipeline_rule_invalid: grep accepts exactly one pattern")
			}
			pattern = arg
		}
	}
	if pattern == "" {
		return pipelineOperation{}, errors.New("pipeline_rule_invalid: grep requires a pattern")
	}
	if len(pattern) > maxRegexBytes {
		return pipelineOperation{}, errors.New("pipeline_rule_invalid: grep pattern exceeds 1024 bytes")
	}
	if caseInsensitive {
		pattern = "(?i:" + pattern + ")"
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return pipelineOperation{}, fmt.Errorf("pipeline_rule_invalid: invalid grep pattern: %w", err)
	}
	return pipelineOperation{kind: "grep", regex: compiled, invert: invert}, nil
}

func parseCutOperation(args []string) (pipelineOperation, error) {
	delimiter := ""
	fieldSpec := ""
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "-d":
			index++
			if index >= len(args) || delimiter != "" {
				return pipelineOperation{}, errors.New("pipeline_rule_invalid: cut requires one -d DELIMITER")
			}
			delimiter = args[index]
		case "-f":
			index++
			if index >= len(args) || fieldSpec != "" {
				return pipelineOperation{}, errors.New("pipeline_rule_invalid: cut requires one -f FIELDS")
			}
			fieldSpec = args[index]
		default:
			return pipelineOperation{}, fmt.Errorf("pipeline_rule_invalid: unsupported cut argument %s", args[index])
		}
	}
	if delimiter == `\t` {
		delimiter = "\t"
	}
	if delimiter == "" || utf8.RuneCountInString(delimiter) != 1 {
		return pipelineOperation{}, errors.New("pipeline_rule_invalid: cut delimiter must be exactly one character")
	}
	fields, err := parseCutFields(fieldSpec)
	if err != nil {
		return pipelineOperation{}, err
	}
	return pipelineOperation{kind: "cut", delimiter: delimiter, fieldOrder: fields}, nil
}

func parseCutFields(spec string) ([]int, error) {
	if strings.TrimSpace(spec) == "" {
		return nil, errors.New("pipeline_rule_invalid: cut requires fields")
	}
	seen := make(map[int]struct{})
	fields := make([]int, 0)
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, errors.New("pipeline_rule_invalid: cut field list is invalid")
		}
		start, end := 0, 0
		if strings.Contains(part, "-") {
			bounds := strings.Split(part, "-")
			if len(bounds) != 2 {
				return nil, errors.New("pipeline_rule_invalid: cut field range is invalid")
			}
			var err error
			start, err = strconv.Atoi(bounds[0])
			if err != nil {
				return nil, errors.New("pipeline_rule_invalid: cut field range is invalid")
			}
			end, err = strconv.Atoi(bounds[1])
			if err != nil || end < start {
				return nil, errors.New("pipeline_rule_invalid: cut field range is invalid")
			}
		} else {
			value, err := strconv.Atoi(part)
			if err != nil {
				return nil, errors.New("pipeline_rule_invalid: cut field is invalid")
			}
			start, end = value, value
		}
		if start < 1 || end > maxCutFieldIndex {
			return nil, fmt.Errorf("pipeline_rule_invalid: cut fields must be between 1 and %d", maxCutFieldIndex)
		}
		for value := start; value <= end; value++ {
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			fields = append(fields, value-1)
			if len(fields) > maxCutFields {
				return nil, fmt.Errorf("pipeline_rule_invalid: cut supports at most %d fields", maxCutFields)
			}
		}
	}
	return fields, nil
}

func applyOperations(lines []string, operations []pipelineOperation) ([]string, error) {
	out := append([]string(nil), lines...)
	for _, operation := range operations {
		switch operation.kind {
		case "cat":
		case "grep":
			filtered := make([]string, 0, len(out))
			for _, line := range out {
				matches := operation.regex.MatchString(line)
				if operation.invert {
					matches = !matches
				}
				if matches {
					filtered = append(filtered, line)
				}
			}
			out = filtered
		case "head":
			if operation.count < len(out) {
				out = out[:operation.count]
			}
		case "tail":
			if operation.count == 0 {
				out = nil
			} else if operation.count < len(out) {
				out = out[len(out)-operation.count:]
			}
		case "sort":
			sort.Strings(out)
			if operation.reverse {
				for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
					out[left], out[right] = out[right], out[left]
				}
			}
		case "uniq":
			if len(out) > 1 {
				unique := out[:1]
				for _, line := range out[1:] {
					if line != unique[len(unique)-1] {
						unique = append(unique, line)
					}
				}
				out = unique
			}
		case "cut":
			cutLines := make([]string, 0, len(out))
			for _, line := range out {
				if !strings.Contains(line, operation.delimiter) {
					cutLines = append(cutLines, line)
					continue
				}
				parts := strings.Split(line, operation.delimiter)
				selected := make([]string, 0, len(operation.fieldOrder))
				for _, field := range operation.fieldOrder {
					if field < len(parts) {
						selected = append(selected, parts[field])
					}
				}
				cutLines = append(cutLines, strings.Join(selected, operation.delimiter))
			}
			out = cutLines
		default:
			return nil, fmt.Errorf("pipeline_operation_not_allowed: %s", operation.kind)
		}
		if joinedBytes(out) > maxIntermediateBytes {
			return nil, errors.New("pipeline_limit_exceeded: intermediate output exceeds limit")
		}
	}
	return out, nil
}

func joinedBytes(lines []string) int {
	total := 0
	for _, line := range lines {
		total += len(line) + 1
		if total > maxIntermediateBytes {
			return total
		}
	}
	return total
}

func splitRulePipeline(rule string) ([]string, error) {
	segments := make([]string, 0, 4)
	var current strings.Builder
	var quote rune
	runes := []rune(rule)
	for index := 0; index < len(runes); index++ {
		value := runes[index]
		if quote != 0 {
			if value == quote {
				quote = 0
				current.WriteRune(value)
				continue
			}
			if value == '\\' && quote == '"' && index+1 < len(runes) && isEscapableRuleRune(runes[index+1]) {
				current.WriteRune(value)
				index++
				current.WriteRune(runes[index])
				continue
			}
			current.WriteRune(value)
			continue
		}
		switch value {
		case '\'', '"':
			quote = value
			current.WriteRune(value)
		case '\\':
			if index+1 < len(runes) && isEscapableRuleRune(runes[index+1]) {
				current.WriteRune(value)
				index++
				current.WriteRune(runes[index])
			} else {
				current.WriteRune(value)
			}
		case '|':
			segment := strings.TrimSpace(current.String())
			if segment == "" {
				return nil, errors.New("empty pipeline operation")
			}
			segments = append(segments, segment)
			current.Reset()
		default:
			current.WriteRune(value)
		}
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote")
	}
	segment := strings.TrimSpace(current.String())
	if segment == "" {
		return nil, errors.New("empty pipeline operation")
	}
	segments = append(segments, segment)
	return segments, nil
}

func tokenizeRuleSegment(segment string) ([]string, error) {
	tokens := make([]string, 0, 4)
	var current strings.Builder
	var quote rune
	started := false
	runes := []rune(segment)
	flush := func() {
		if started {
			tokens = append(tokens, current.String())
			current.Reset()
			started = false
		}
	}
	for index := 0; index < len(runes); index++ {
		value := runes[index]
		if quote != 0 {
			if value == quote {
				quote = 0
				started = true
				continue
			}
			if value == '\\' && quote == '"' && index+1 < len(runes) && isEscapableRuleRune(runes[index+1]) {
				index++
				current.WriteRune(runes[index])
				started = true
				continue
			}
			current.WriteRune(value)
			started = true
			continue
		}
		if unicode.IsSpace(value) {
			flush()
			continue
		}
		switch value {
		case '\'', '"':
			quote = value
			started = true
		case '\\':
			if index+1 < len(runes) && isEscapableRuleRune(runes[index+1]) {
				index++
				current.WriteRune(runes[index])
			} else {
				current.WriteRune(value)
			}
			started = true
		default:
			current.WriteRune(value)
			started = true
		}
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote")
	}
	flush()
	return tokens, nil
}

func isEscapableRuleRune(value rune) bool {
	return unicode.IsSpace(value) || value == '\\' || value == '\'' || value == '"' || value == '|'
}

var pipelineAliasPattern = regexp.MustCompile(`^p[1-9][0-9]*$`)

func validAlias(alias string) bool {
	return pipelineAliasPattern.MatchString(strings.TrimSpace(alias))
}
