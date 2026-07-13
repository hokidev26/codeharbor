// Package schedules parses and evaluates the deliberately small schedule grammar
// accepted by Autoto.
package schedules

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// MaxExpressionBytes matches the persistence limit and bounds parser work.
	MaxExpressionBytes = 256
	maxTimezoneBytes   = 255
	maxSearchMinutes   = 366 * 24 * 60
	minEveryDuration   = time.Minute
	maxEveryDuration   = 30 * 24 * time.Hour
)

// ErrNoNext is returned when a cron expression has no match in the bounded
// 366-day search window.
var ErrNoNext = errors.New("no matching schedule time within 366 days")

type expressionKind uint8

const (
	kindCron expressionKind = iota
	kindEvery
)

type cronField struct {
	bits         uint64
	unrestricted bool
}

func (f cronField) matches(value int) bool {
	return value >= 0 && value < 64 && f.bits&(uint64(1)<<uint(value)) != 0
}

// Expression is a validated schedule expression bound to an IANA timezone.
// It is immutable and safe for concurrent use after parsing.
type Expression struct {
	kind     expressionKind
	location *time.Location
	interval time.Duration
	minute   cronField
	hour     cronField
	day      cronField
	month    cronField
	weekday  cronField
}

// ParseExpression validates expression and loads timezone with time.LoadLocation.
func ParseExpression(expression, timezone string) (*Expression, error) {
	if len(expression) == 0 {
		return nil, errors.New("schedule expression is required")
	}
	if len(expression) > MaxExpressionBytes {
		return nil, fmt.Errorf("schedule expression exceeds %d bytes", MaxExpressionBytes)
	}
	if err := validateExpressionText(expression); err != nil {
		return nil, err
	}
	location, err := loadTimezone(timezone)
	if err != nil {
		return nil, err
	}

	expression = strings.TrimSpace(expression)
	if expression == "" {
		return nil, errors.New("schedule expression is required")
	}
	if strings.HasPrefix(expression, "@") {
		return parseDescriptor(expression, location)
	}
	return parseCron(expression, location)
}

// Parse is a concise alias for ParseExpression.
func Parse(expression, timezone string) (*Expression, error) {
	return ParseExpression(expression, timezone)
}

func validateExpressionText(value string) error {
	for i := 0; i < len(value); i++ {
		if value[i] < 0x20 && value[i] != '\t' || value[i] == 0x7f {
			return errors.New("schedule expression contains a control character")
		}
	}
	return nil
}

func loadTimezone(name string) (*time.Location, error) {
	if len(name) == 0 {
		return nil, errors.New("schedule timezone is required")
	}
	if len(name) > maxTimezoneBytes {
		return nil, fmt.Errorf("schedule timezone exceeds %d bytes", maxTimezoneBytes)
	}
	for i := 0; i < len(name); i++ {
		if name[i] < 0x20 || name[i] == 0x7f {
			return nil, errors.New("schedule timezone contains a control character")
		}
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("schedule timezone is required")
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("load schedule timezone: %w", err)
	}
	return location, nil
}

func parseDescriptor(expression string, location *time.Location) (*Expression, error) {
	switch expression {
	case "@hourly":
		return parseCron("0 * * * *", location)
	case "@daily":
		return parseCron("0 0 * * *", location)
	case "@weekly":
		return parseCron("0 0 * * 0", location)
	}

	parts := strings.Fields(expression)
	if len(parts) != 2 || parts[0] != "@every" {
		return nil, errors.New("unsupported schedule descriptor")
	}
	interval, err := parseEveryDuration(parts[1])
	if err != nil {
		return nil, err
	}
	return &Expression{kind: kindEvery, location: location, interval: interval}, nil
}

func parseEveryDuration(value string) (time.Duration, error) {
	translated := value
	var err error
	if strings.Contains(value, "d") {
		translated, err = expandDayUnits(value)
		if err != nil {
			return 0, errors.New("invalid @every duration")
		}
	}
	interval, err := time.ParseDuration(translated)
	if err != nil {
		return 0, errors.New("invalid @every duration")
	}
	if interval < minEveryDuration || interval > maxEveryDuration {
		return 0, errors.New("@every duration must be between 1m and 30d")
	}
	return interval, nil
}

func expandDayUnits(value string) (string, error) {
	var translated strings.Builder
	translated.Grow(len(value) + 4)
	unwritten := 0
	for i := 0; i < len(value); i++ {
		if value[i] != 'd' {
			continue
		}
		start := i
		for start > unwritten && isASCIIDigit(value[start-1]) {
			start--
		}
		if start == i || start > 0 && (value[start-1] == '.' || value[start-1] == '+' || value[start-1] == '-') {
			return "", errors.New("day units require an unsigned integer")
		}
		days, err := strconv.ParseUint(value[start:i], 10, 8)
		if err != nil || days > 30 {
			return "", errors.New("invalid day duration")
		}
		translated.WriteString(value[unwritten:start])
		translated.WriteString(strconv.FormatUint(days*24, 10))
		translated.WriteByte('h')
		unwritten = i + 1
	}
	translated.WriteString(value[unwritten:])
	return translated.String(), nil
}

func parseCron(expression string, location *time.Location) (*Expression, error) {
	parts := strings.Fields(expression)
	if len(parts) != 5 {
		return nil, errors.New("cron expression must contain exactly five fields")
	}

	minute, err := parseCronField("minute", parts[0], 0, 59, false)
	if err != nil {
		return nil, err
	}
	hour, err := parseCronField("hour", parts[1], 0, 23, false)
	if err != nil {
		return nil, err
	}
	day, err := parseCronField("day-of-month", parts[2], 1, 31, false)
	if err != nil {
		return nil, err
	}
	month, err := parseCronField("month", parts[3], 1, 12, false)
	if err != nil {
		return nil, err
	}
	weekday, err := parseCronField("day-of-week", parts[4], 0, 7, true)
	if err != nil {
		return nil, err
	}

	return &Expression{
		kind:     kindCron,
		location: location,
		minute:   minute,
		hour:     hour,
		day:      day,
		month:    month,
		weekday:  weekday,
	}, nil
}

func parseCronField(name, value string, minimum, maximum int, sundayAlias bool) (cronField, error) {
	if value == "*" {
		return cronField{bits: allBits(minimum, maximum, sundayAlias), unrestricted: true}, nil
	}
	if strings.HasPrefix(value, "*/") {
		stepText := strings.TrimPrefix(value, "*/")
		step, ok := parseUnsignedInt(stepText)
		width := maximum - minimum + 1
		if !ok || step < 1 || step > width {
			return cronField{}, fmt.Errorf("invalid %s step", name)
		}
		var bits uint64
		for candidate := minimum; candidate <= maximum; candidate += step {
			bits |= valueBit(candidate, sundayAlias)
		}
		return cronField{bits: bits}, nil
	}

	if strings.Contains(value, ",") {
		items := strings.Split(value, ",")
		if len(items) < 2 {
			return cronField{}, fmt.Errorf("invalid %s list", name)
		}
		var bits uint64
		for _, item := range items {
			candidate, ok := parseUnsignedInt(item)
			if !ok || candidate < minimum || candidate > maximum {
				return cronField{}, fmt.Errorf("invalid %s list", name)
			}
			bits |= valueBit(candidate, sundayAlias)
		}
		return cronField{bits: bits}, nil
	}

	candidate, ok := parseUnsignedInt(value)
	if !ok || candidate < minimum || candidate > maximum {
		return cronField{}, fmt.Errorf("invalid %s value", name)
	}
	return cronField{bits: valueBit(candidate, sundayAlias)}, nil
}

func parseUnsignedInt(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	for i := 0; i < len(value); i++ {
		if !isASCIIDigit(value[i]) {
			return 0, false
		}
	}
	parsed, err := strconv.ParseUint(value, 10, 8)
	if err != nil {
		return 0, false
	}
	return int(parsed), true
}

func isASCIIDigit(value byte) bool {
	return value >= '0' && value <= '9'
}

func allBits(minimum, maximum int, sundayAlias bool) uint64 {
	var bits uint64
	for value := minimum; value <= maximum; value++ {
		bits |= valueBit(value, sundayAlias)
	}
	return bits
}

func valueBit(value int, sundayAlias bool) uint64 {
	if sundayAlias && value == 7 {
		value = 0
	}
	return uint64(1) << uint(value)
}

// Next returns the first matching instant strictly later than after. Cron
// expressions are checked one minute at a time for at most 366 days.
func (expression *Expression) Next(after time.Time) (time.Time, error) {
	if expression == nil || expression.location == nil {
		return time.Time{}, errors.New("schedule expression is not initialized")
	}
	if expression.kind == kindEvery {
		return after.Add(expression.interval).In(expression.location), nil
	}

	candidate := after.Truncate(time.Minute).Add(time.Minute)
	for checked := 0; checked < maxSearchMinutes; checked++ {
		local := candidate.In(expression.location)
		if expression.matches(local) {
			return local, nil
		}
		candidate = candidate.Add(time.Minute)
	}
	return time.Time{}, ErrNoNext
}

func (expression *Expression) matches(candidate time.Time) bool {
	if !expression.minute.matches(candidate.Minute()) ||
		!expression.hour.matches(candidate.Hour()) ||
		!expression.month.matches(int(candidate.Month())) {
		return false
	}

	dayMatches := expression.day.matches(candidate.Day())
	weekdayMatches := expression.weekday.matches(int(candidate.Weekday()))
	switch {
	case !expression.day.unrestricted && !expression.weekday.unrestricted:
		return dayMatches || weekdayMatches
	case !expression.day.unrestricted:
		return dayMatches
	case !expression.weekday.unrestricted:
		return weekdayMatches
	default:
		return true
	}
}
