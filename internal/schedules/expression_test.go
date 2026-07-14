package schedules

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDescriptorsAndEvery(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		after      time.Time
		want       time.Time
	}{
		{
			name:       "hourly",
			expression: "@hourly",
			after:      time.Date(2024, time.January, 2, 10, 15, 42, 0, time.UTC),
			want:       time.Date(2024, time.January, 2, 11, 0, 0, 0, time.UTC),
		},
		{
			name:       "daily is strict",
			expression: "@daily",
			after:      time.Date(2024, time.January, 2, 0, 0, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 3, 0, 0, 0, 0, time.UTC),
		},
		{
			name:       "weekly uses Sunday",
			expression: "@weekly",
			after:      time.Date(2024, time.January, 7, 0, 0, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 14, 0, 0, 0, 0, time.UTC),
		},
		{
			name:       "every preserves elapsed duration",
			expression: "@every 1h30m",
			after:      time.Date(2024, time.January, 2, 10, 15, 42, 123, time.UTC),
			want:       time.Date(2024, time.January, 2, 11, 45, 42, 123, time.UTC),
		},
		{
			name:       "every supports day suffix",
			expression: "@every 1d12h",
			after:      time.Date(2024, time.January, 2, 10, 0, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 3, 22, 0, 0, 0, time.UTC),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			expression := mustParse(t, test.expression, "UTC")
			got, err := expression.Next(test.after)
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(test.want) {
				t.Fatalf("Next() = %s, want %s", got, test.want)
			}
			if !got.After(test.after) {
				t.Fatalf("Next() must be strictly later than %s, got %s", test.after, got)
			}
		})
	}
}

func TestEveryDurationBounds(t *testing.T) {
	valid := []string{
		"@every 1m",
		"@every 1.5m",
		"@every 720h",
		"@every 30d",
		"@every 29d23h59m59s",
	}
	for _, expression := range valid {
		t.Run("valid_"+expression, func(t *testing.T) {
			if _, err := ParseExpression(expression, "UTC"); err != nil {
				t.Fatalf("ParseExpression(%q) returned %v", expression, err)
			}
		})
	}

	invalid := []string{
		"@every",
		"@every 0",
		"@every 59s",
		"@every -1m",
		"@every 30d1ns",
		"@every 31d",
		"@every 721h",
		"@every 1.5d",
		"@every 1d garbage",
		"@monthly",
		"@EVERY 1m",
	}
	for _, expression := range invalid {
		t.Run("invalid_"+expression, func(t *testing.T) {
			if _, err := ParseExpression(expression, "UTC"); err == nil {
				t.Fatalf("ParseExpression(%q) unexpectedly succeeded", expression)
			}
		})
	}
}

func TestCronFieldFormsAndStrictNext(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		after      time.Time
		want       time.Time
	}{
		{
			name:       "single integers",
			expression: "5 9 2 1 *",
			after:      time.Date(2024, time.January, 2, 9, 4, 59, 0, time.UTC),
			want:       time.Date(2024, time.January, 2, 9, 5, 0, 0, time.UTC),
		},
		{
			name:       "comma lists",
			expression: "15,45 0,12 * 1,7 *",
			after:      time.Date(2024, time.January, 1, 0, 15, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 1, 0, 45, 0, 0, time.UTC),
		},
		{
			name:       "steps start at field minimum",
			expression: "*/20 */6 * * *",
			after:      time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 1, 0, 20, 0, 0, time.UTC),
		},
		{
			name:       "exact minute is excluded",
			expression: "0 9 * * *",
			after:      time.Date(2024, time.January, 1, 9, 0, 0, 0, time.UTC),
			want:       time.Date(2024, time.January, 2, 9, 0, 0, 0, time.UTC),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := mustParse(t, test.expression, "UTC").Next(test.after)
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(test.want) {
				t.Fatalf("Next() = %s, want %s", got, test.want)
			}
			if got.Second() != 0 || got.Nanosecond() != 0 {
				t.Fatalf("cron result must be minute-aligned: %s", got)
			}
		})
	}
}

func TestCronDayOfMonthAndWeekSemantics(t *testing.T) {
	bothRestricted := mustParse(t, "0 9 13 * 1", "UTC")
	got, err := bothRestricted.Next(time.Date(2024, time.January, 14, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, time.January, 15, 9, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("both restricted must use OR: got %s, want %s", got, want)
	}

	onlyDay := mustParse(t, "0 9 13 * *", "UTC")
	got, err = onlyDay.Next(time.Date(2024, time.January, 14, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	want = time.Date(2024, time.February, 13, 9, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("restricted day-of-month must control wildcard weekday: got %s, want %s", got, want)
	}

	onlyWeekday := mustParse(t, "0 9 * * 1", "UTC")
	got, err = onlyWeekday.Next(time.Date(2024, time.January, 15, 9, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	want = time.Date(2024, time.January, 22, 9, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("restricted weekday must control wildcard day-of-month: got %s, want %s", got, want)
	}
}

func TestSundayAcceptsZeroAndSeven(t *testing.T) {
	after := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	zero, err := mustParse(t, "0 0 * * 0", "UTC").Next(after)
	if err != nil {
		t.Fatal(err)
	}
	seven, err := mustParse(t, "0 0 * * 7", "UTC").Next(after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, time.January, 7, 0, 0, 0, 0, time.UTC)
	if !zero.Equal(want) || !seven.Equal(want) {
		t.Fatalf("Sunday aliases returned %s and %s, want %s", zero, seven, want)
	}
}

func TestTimezoneControlsCalendarMatching(t *testing.T) {
	expression := mustParse(t, "0 9 * * *", "America/Los_Angeles")
	after := time.Date(2024, time.January, 2, 16, 59, 30, 0, time.UTC)
	got, err := expression.Next(after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, time.January, 2, 17, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Next() = %s, want instant %s", got, want)
	}
	if got.Location().String() != "America/Los_Angeles" || got.Hour() != 9 {
		t.Fatalf("result must be returned in the schedule timezone: %s (%s)", got, got.Location())
	}
}

func TestDSTSpringForwardSkipsMissingMinute(t *testing.T) {
	location := mustLocation(t, "America/New_York")
	expression := mustParse(t, "30 2 * * *", location.String())
	after := time.Date(2024, time.March, 9, 2, 30, 0, 0, location)
	got, err := expression.Next(after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, time.March, 11, 2, 30, 0, 0, location)
	if !got.Equal(want) {
		t.Fatalf("missing DST minute must be skipped: got %s, want %s", got, want)
	}
}

func TestDSTFallBackCanMatchBothRepeatedMinutes(t *testing.T) {
	expression := mustParse(t, "30 1 * * *", "America/New_York")

	beforeFirst := time.Date(2024, time.November, 3, 5, 29, 0, 0, time.UTC)
	first, err := expression.Next(beforeFirst)
	if err != nil {
		t.Fatal(err)
	}
	wantFirst := time.Date(2024, time.November, 3, 5, 30, 0, 0, time.UTC)
	if !first.Equal(wantFirst) {
		t.Fatalf("first repeated minute = %s, want %s", first, wantFirst)
	}

	second, err := expression.Next(first)
	if err != nil {
		t.Fatal(err)
	}
	wantSecond := time.Date(2024, time.November, 3, 6, 30, 0, 0, time.UTC)
	if !second.Equal(wantSecond) {
		t.Fatalf("second repeated minute = %s, want %s", second, wantSecond)
	}
	if first.Format("2006-01-02 15:04") != second.Format("2006-01-02 15:04") {
		t.Fatalf("expected repeated local minute, got %s and %s", first, second)
	}
}

func TestDailyUsesLocalMidnightAcrossDST(t *testing.T) {
	location := mustLocation(t, "America/New_York")
	expression := mustParse(t, "@daily", location.String())
	after := time.Date(2024, time.March, 10, 0, 0, 0, 0, location)
	got, err := expression.Next(after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, time.March, 11, 0, 0, 0, 0, location)
	if !got.Equal(want) {
		t.Fatalf("daily schedule = %s, want %s", got, want)
	}
	if got.Sub(after) != 23*time.Hour {
		t.Fatalf("calendar midnight across spring DST should be 23 elapsed hours, got %s", got.Sub(after))
	}
}

func TestRejectsUnsupportedCronGrammarAndValues(t *testing.T) {
	invalid := []string{
		"",
		"* * * *",
		"* * * * * *",
		"0 0 0 * * *",
		"1-5 * * * *",
		"MON * * * *",
		"0 0 * JAN *",
		"0 0 * * MON",
		"60 * * * *",
		"0 24 * * *",
		"0 0 0 * *",
		"0 0 32 * *",
		"0 0 * 0 *",
		"0 0 * 13 *",
		"0 0 * * 8",
		"*/0 * * * *",
		"*/61 * * * *",
		"*,1 * * * *",
		"1, * * * *",
		"1,,2 * * * *",
		"1,2, * * * *",
		"1/2 * * * *",
		"+1 * * * *",
		"-1 * * * *",
	}

	for _, expression := range invalid {
		t.Run(expression, func(t *testing.T) {
			if _, err := ParseExpression(expression, "UTC"); err == nil {
				t.Fatalf("ParseExpression(%q) unexpectedly succeeded", expression)
			}
		})
	}
}

func TestRejectsInvalidTimezoneAndControlCharacters(t *testing.T) {
	invalidTimezones := []string{
		"",
		"Not/A_Real_Zone",
		"UTC\x00ignored",
		"UTC\n",
		strings.Repeat("A", maxTimezoneBytes+1),
	}
	for _, timezone := range invalidTimezones {
		if _, err := ParseExpression("@daily", timezone); err == nil {
			t.Fatalf("timezone %q unexpectedly succeeded", timezone)
		}
	}

	invalidExpressions := []string{
		"0 0 * * *\x00",
		"0 0 * * *\n@daily",
		"0 0 * * *\r",
		"0 0 * * *\x7f",
	}
	for _, expression := range invalidExpressions {
		if _, err := ParseExpression(expression, "UTC"); err == nil {
			t.Fatalf("expression %q unexpectedly succeeded", expression)
		}
	}
}

func TestRejectsMaliciouslyLongInputsBeforeParsing(t *testing.T) {
	tooLong := strings.Repeat("*", MaxExpressionBytes+1)
	if _, err := ParseExpression(tooLong, "UTC"); err == nil {
		t.Fatal("oversized expression unexpectedly succeeded")
	}

	hugeNumber := "*/" + strings.Repeat("9", 240) + " * * * *"
	if len(hugeNumber) > MaxExpressionBytes {
		t.Fatalf("test input must exercise numeric parsing, got %d bytes", len(hugeNumber))
	}
	if _, err := ParseExpression(hugeNumber, "UTC"); err == nil {
		t.Fatal("oversized numeric field unexpectedly succeeded")
	}
}

func TestNextSearchIsBounded(t *testing.T) {
	expression := mustParse(t, "0 0 31 2 *", "UTC")
	got, err := expression.Next(time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC))
	if !errors.Is(err, ErrNoNext) {
		t.Fatalf("Next() error = %v, want ErrNoNext", err)
	}
	if !got.IsZero() {
		t.Fatalf("failed bounded search returned non-zero time %s", got)
	}
}

func TestNilExpressionNextFails(t *testing.T) {
	var expression *Expression
	if _, err := expression.Next(time.Now()); err == nil {
		t.Fatal("nil expression Next unexpectedly succeeded")
	}
}

func mustParse(t *testing.T, expression, timezone string) *Expression {
	t.Helper()
	parsed, err := Parse(expression, timezone)
	if err != nil {
		t.Fatalf("Parse(%q, %q): %v", expression, timezone, err)
	}
	return parsed
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	location, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("time.LoadLocation(%q): %v", name, err)
	}
	return location
}
