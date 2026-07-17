package toolpipeline

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseAndApplyRestrictedRule(t *testing.T) {
	parsed, err := parseRule(`from p1 p2 | grep -i "error|failed" | sort | uniq | head -n 3`)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parsed.aliases, []string{"p1", "p2"}) {
		t.Fatalf("unexpected aliases: %v", parsed.aliases)
	}
	lines, err := applyOperations([]string{"failed b", "ok", "ERROR a", "failed b", "error z"}, parsed.operations)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"ERROR a", "error z", "failed b"}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("unexpected filtered lines: got=%v want=%v", lines, want)
	}
}

func TestTailReverseSortAndCut(t *testing.T) {
	parsed, err := parseRule(`cut -d "," -f 1,3 | sort -r | tail -n 2`)
	if err != nil {
		t.Fatal(err)
	}
	lines, err := applyOperations([]string{"a,skip,3", "c,skip,1", "b,skip,2"}, parsed.operations)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"b,2", "a,3"}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("unexpected cut result: got=%v want=%v", lines, want)
	}
}

func TestRuleParserRejectsShellSyntaxAndUnsupportedOperations(t *testing.T) {
	for _, rule := range []string{
		`from p1 | xargs rm`,
		`from p1 | eval "cat"`,
		`from p1 | grep error > out.txt`,
		`from p1 | grep "unterminated`,
		`from p1 || head -n 1`,
	} {
		t.Run(strings.ReplaceAll(rule, " ", "_"), func(t *testing.T) {
			if _, err := parseRule(rule); err == nil {
				t.Fatalf("expected rejection for %q", rule)
			}
		})
	}
}

func TestRuleParserPreservesRegexBackslashes(t *testing.T) {
	parsed, err := parseRule(`grep "^item\\d+$"`)
	if err != nil {
		t.Fatal(err)
	}
	lines, err := applyOperations([]string{"item1", "itemx", "item22"}, parsed.operations)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(lines, []string{"item1", "item22"}) {
		t.Fatalf("regex backslash was not preserved: %v", lines)
	}
}
