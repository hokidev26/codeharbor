package tools

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

// CommandFacts is a conservative, argument-free summary of a POSIX shell
// command. It is suitable for JSON event metadata; it intentionally never
// stores command arguments, redirection targets, or command-substitution text.
// Subcommand is a normalized allowlisted category rather than a raw argument.
type CommandFacts struct {
	ParseKnown   bool     `json:"parseKnown"`
	Program      string   `json:"program,omitempty"`
	Subcommand   string   `json:"subcommand,omitempty"`
	CommandCount int      `json:"commandCount"`
	Compound     bool     `json:"compound"`
	Pipeline     bool     `json:"pipeline"`
	Redirection  bool     `json:"redirection"`
	Substitution bool     `json:"substitution"`
	Background   bool     `json:"background"`
	Effects      []string `json:"effects,omitempty"`
	Dangerous    []string `json:"dangerous,omitempty"`
}

type bashCommandAnalysis struct {
	facts   CommandFacts
	warning string
}

// AnalyzeBashCommand returns a conservative, JSON-safe summary of command.
// It only treats POSIX shell syntax as known. On Windows, BashTool executes
// cmd.exe rather than a POSIX shell, so ParseKnown is always false.
func AnalyzeBashCommand(command string) CommandFacts {
	return analyzeBashCommand(command).facts
}

func analyzeBashCommand(command string) bashCommandAnalysis {
	facts := CommandFacts{}
	if runtime.GOOS != "windows" {
		facts = analyzePOSIXShell(command, 0)
	}
	warning := commandDangerWarningFromFacts(facts)
	if warning == "" {
		// Retain the established string checks as a defense-in-depth fallback
		// for malformed, non-POSIX, and otherwise unclassified input.
		warning = legacyBashDangerWarning(command)
	}
	return bashCommandAnalysis{facts: facts, warning: warning}
}

func analyzePOSIXShell(command string, depth int) CommandFacts {
	var facts CommandFacts
	file, err := syntax.NewParser(syntax.Variant(syntax.LangPOSIX)).Parse(strings.NewReader(command), "command")
	if err != nil {
		return facts
	}
	facts.ParseKnown = true
	if len(file.Stmts) > 1 {
		facts.Compound = true
	}

	collector := commandFactsCollector{facts: &facts, effects: make(map[string]struct{}), dangerous: make(map[string]struct{})}
	syntax.Walk(file, collector.visit)
	collector.finish()

	if depth < maxNestedShellAnalysisDepth {
		for _, nested := range collector.nestedScripts {
			nestedFacts := analyzePOSIXShell(nested.script, depth+1)
			if !nestedFacts.ParseKnown || nested.nonPOSIX {
				facts.ParseKnown = false
			}
			facts.CommandCount += nestedFacts.CommandCount
			facts.Compound = facts.Compound || nestedFacts.Compound
			facts.Pipeline = facts.Pipeline || nestedFacts.Pipeline
			facts.Redirection = facts.Redirection || nestedFacts.Redirection
			facts.Substitution = facts.Substitution || nestedFacts.Substitution
			facts.Background = facts.Background || nestedFacts.Background
			facts.Effects = mergeFactLabels(facts.Effects, nestedFacts.Effects)
			facts.Dangerous = mergeFactLabels(facts.Dangerous, nestedFacts.Dangerous)
		}
	} else if len(collector.nestedScripts) > 0 {
		facts.ParseKnown = false
	}
	return facts
}

const maxNestedShellAnalysisDepth = 2

type nestedShellScript struct {
	script   string
	nonPOSIX bool
}

type commandFactsCollector struct {
	facts         *CommandFacts
	effects       map[string]struct{}
	dangerous     map[string]struct{}
	nestedScripts []nestedShellScript
}

func (c *commandFactsCollector) visit(node syntax.Node) bool {
	switch node := node.(type) {
	case *syntax.Stmt:
		if node.Background {
			c.facts.Background = true
		}
	case *syntax.CallExpr:
		c.visitCall(node)
	case *syntax.BinaryCmd:
		c.facts.Compound = true
		if node.Op.String() == "|" {
			c.facts.Pipeline = true
			c.visitPipeline(node)
		}
	case *syntax.Redirect:
		c.facts.Redirection = true
		if truncatesRedirect(node) {
			c.effect("filesystem-write")
			c.danger("file-truncate")
		}
	case *syntax.CmdSubst:
		c.facts.Substitution = true
		c.facts.Compound = true
	case *syntax.Subshell, *syntax.Block, *syntax.IfClause, *syntax.WhileClause, *syntax.ForClause, *syntax.FuncDecl:
		c.facts.Compound = true
	}
	return true
}

func (c *commandFactsCollector) visitCall(call *syntax.CallExpr) {
	c.facts.CommandCount++
	if len(call.Args) == 0 {
		return
	}
	program, knownProgram := safeStaticWord(call.Args[0])
	if c.facts.Program == "" {
		if knownProgram {
			c.facts.Program = safeProgramName(program)
		} else {
			c.facts.Program = "dynamic"
		}
	}
	if !knownProgram {
		return
	}
	program = safeProgramName(program)
	if c.facts.Subcommand == "" && isSubcommandProgram(program) && len(call.Args) > 1 {
		if subcommand, ok := safeStaticWord(call.Args[1]); ok {
			c.facts.Subcommand = stableSubcommand(program, subcommand)
		}
	}
	c.inspectSemanticCall(program, call.Args[1:], 0)
}

const maxWrappedCommandAnalysisDepth = 4

func (c *commandFactsCollector) inspectSemanticCall(program string, args []*syntax.Word, depth int) {
	c.classifyCall(program, args)
	c.collectNestedShell(program, args)
	if depth >= maxWrappedCommandAnalysisDepth {
		return
	}
	if program == "find" {
		for _, nested := range findExecCommands(args) {
			if !nested.known {
				c.facts.ParseKnown = false
				continue
			}
			c.effect("shell-execution")
			c.inspectSemanticCall(nested.program, nested.args, depth+1)
		}
	}
	if program == "eval" {
		script, ok := staticJoinedWords(args)
		if !ok {
			c.facts.ParseKnown = false
			return
		}
		c.effect("shell-execution")
		c.facts.Compound = true
		c.nestedScripts = append(c.nestedScripts, nestedShellScript{script: script})
		return
	}
	wrappedProgram, wrappedArgs, wrapped, known := unwrapStaticCommand(program, args)
	if !known {
		c.facts.ParseKnown = false
		return
	}
	if !wrapped {
		return
	}
	c.effect("shell-execution")
	c.inspectSemanticCall(wrappedProgram, wrappedArgs, depth+1)
}

func (c *commandFactsCollector) classifyCall(program string, args []*syntax.Word) {
	switch program {
	case "rm", "rmdir", "mv":
		if program != "mv" || hasStaticArgument(args, "/dev/null") {
			c.effect("filesystem-delete")
			c.danger("file-delete")
		}
	case "sudo":
		c.effect("privileged-execution")
		c.danger("privilege-escalation")
	case "dd":
		c.effect("disk-write")
		c.danger("disk-write")
	case "shred":
		c.effect("filesystem-delete")
		c.danger("file-destroy")
	case "find":
		if hasStaticArgument(args, "-delete") {
			c.effect("filesystem-delete")
			c.danger("find-delete")
		}
	case "git":
		if hasStaticArgument(args, "clean") && hasForceArgument(args) {
			c.effect("filesystem-delete")
			c.danger("git-clean")
		}
		if hasStaticArgument(args, "reset") && hasStaticArgument(args, "--hard") {
			c.effect("repository-state-discard")
			c.danger("git-reset-hard")
		}
	case "chmod":
		if hasRecursiveArgument(args) && hasStaticArgument(args, "777") {
			c.effect("permission-change")
			c.danger("permission-weaken")
		}
	}
	if strings.HasPrefix(program, "mkfs") {
		c.effect("disk-format")
		c.danger("disk-format")
	}
}

func (c *commandFactsCollector) collectNestedShell(program string, args []*syntax.Word) {
	if !isShellProgram(program) {
		return
	}
	for i := 0; i < len(args); i++ {
		flag, ok := safeStaticWord(args[i])
		if !ok {
			c.facts.ParseKnown = false
			continue
		}
		if !shellCommandStringFlag(flag) {
			continue
		}
		if i+1 >= len(args) {
			c.facts.ParseKnown = false
			return
		}
		script, ok := safeStaticWord(args[i+1])
		if !ok {
			c.facts.ParseKnown = false
			return
		}
		c.effect("nested-shell")
		c.facts.Compound = true
		c.nestedScripts = append(c.nestedScripts, nestedShellScript{script: script, nonPOSIX: program != "sh" && program != "dash"})
		return
	}
}

func shellCommandStringFlag(flag string) bool {
	if flag == "-c" {
		return true
	}
	return len(flag) > 2 && flag[0] == '-' && flag[1] != '-' && strings.ContainsRune(flag[1:], 'c')
}

func staticJoinedWords(words []*syntax.Word) (string, bool) {
	values := make([]string, 0, len(words))
	for _, word := range words {
		value, ok := safeStaticWord(word)
		if !ok {
			return "", false
		}
		values = append(values, value)
	}
	return strings.Join(values, " "), true
}

func unwrapStaticCommand(program string, args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	switch program {
	case "command":
		return unwrapCommandBuiltin(args)
	case "env":
		return unwrapEnvCommand(args)
	case "exec":
		return unwrapExecCommand(args)
	case "nohup":
		return unwrapFirstStaticCommand(args)
	case "xargs":
		return unwrapXargsCommand(args)
	default:
		return "", nil, false, true
	}
}

func unwrapCommandBuiltin(args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	for index, arg := range args {
		value, ok := safeStaticWord(arg)
		if !ok {
			return "", nil, false, false
		}
		switch value {
		case "--":
			return unwrapFirstStaticCommand(args[index+1:])
		case "-p":
			continue
		case "-v", "-V":
			return "", nil, false, true
		}
		if strings.HasPrefix(value, "-") {
			return "", nil, false, false
		}
		program := safeProgramName(value)
		return program, args[index+1:], program != "dynamic", program != "dynamic"
	}
	return "", nil, false, true
}

func unwrapEnvCommand(args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	for index := 0; index < len(args); index++ {
		value, ok := safeStaticWord(args[index])
		if !ok {
			return "", nil, false, false
		}
		switch {
		case value == "--":
			return unwrapFirstStaticCommand(args[index+1:])
		case value == "-i" || value == "--ignore-environment" || value == "-0" || value == "--null" || value == "-v" || value == "--debug":
			continue
		case value == "-u" || value == "--unset" || value == "-C" || value == "--chdir":
			index++
			if index >= len(args) {
				return "", nil, false, false
			}
			continue
		case strings.HasPrefix(value, "--unset=") || strings.HasPrefix(value, "--chdir="):
			continue
		case value == "-S" || value == "--split-string" || strings.HasPrefix(value, "--split-string="):
			return "", nil, false, false
		case strings.HasPrefix(value, "-"):
			return "", nil, false, false
		case strings.Contains(value, "="):
			continue
		default:
			program := safeProgramName(value)
			return program, args[index+1:], program != "dynamic", program != "dynamic"
		}
	}
	return "", nil, false, true
}

func unwrapExecCommand(args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	for index := 0; index < len(args); index++ {
		value, ok := safeStaticWord(args[index])
		if !ok {
			return "", nil, false, false
		}
		if value == "--" {
			return unwrapFirstStaticCommand(args[index+1:])
		}
		if value == "-a" {
			index++
			if index >= len(args) {
				return "", nil, false, false
			}
			continue
		}
		if strings.HasPrefix(value, "-") {
			if strings.Trim(value[1:], "cl") != "" {
				return "", nil, false, false
			}
			continue
		}
		program := safeProgramName(value)
		return program, args[index+1:], program != "dynamic", program != "dynamic"
	}
	return "", nil, false, true
}

func unwrapFirstStaticCommand(args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	if len(args) == 0 {
		return "", nil, false, true
	}
	index := 0
	value, ok := safeStaticWord(args[index])
	if !ok {
		return "", nil, false, false
	}
	if value == "--" {
		index++
		if index >= len(args) {
			return "", nil, false, true
		}
		value, ok = safeStaticWord(args[index])
		if !ok {
			return "", nil, false, false
		}
	}
	program := safeProgramName(value)
	return program, args[index+1:], program != "dynamic", program != "dynamic"
}

func unwrapXargsCommand(args []*syntax.Word) (string, []*syntax.Word, bool, bool) {
	for index := 0; index < len(args); index++ {
		value, ok := safeStaticWord(args[index])
		if !ok {
			return "", nil, false, false
		}
		switch {
		case value == "--":
			return unwrapFirstStaticCommand(args[index+1:])
		case value == "-0" || value == "--null" || value == "-r" || value == "--no-run-if-empty" || value == "-t" || value == "--verbose" || value == "-p" || value == "--interactive" || value == "-x" || value == "--exit" || value == "-o" || value == "--open-tty" || value == "-e" || value == "-i" || value == "-l":
			continue
		case xargsOptionNeedsValue(value):
			index++
			if index >= len(args) {
				return "", nil, false, false
			}
			continue
		case xargsOptionHasAttachedValue(value):
			continue
		case strings.HasPrefix(value, "--eof=") || strings.HasPrefix(value, "--replace=") || strings.HasPrefix(value, "--max-lines=") || strings.HasPrefix(value, "--max-args=") || strings.HasPrefix(value, "--max-procs=") || strings.HasPrefix(value, "--max-chars=") || strings.HasPrefix(value, "--delimiter=") || strings.HasPrefix(value, "--arg-file="):
			continue
		case strings.HasPrefix(value, "-"):
			return "", nil, false, false
		default:
			program := safeProgramName(value)
			return program, args[index+1:], program != "dynamic", program != "dynamic"
		}
	}
	return "", nil, false, true
}

func xargsOptionNeedsValue(value string) bool {
	switch value {
	case "-E", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars", "-d", "--delimiter", "-a", "--arg-file", "-J", "-R", "-S":
		return true
	default:
		return false
	}
}

func xargsOptionHasAttachedValue(value string) bool {
	if len(value) <= 2 || value[0] != '-' || value[1] == '-' {
		return false
	}
	return strings.ContainsRune("EeIiLlnPsdaJRS", rune(value[1]))
}

type staticNestedCommand struct {
	program string
	args    []*syntax.Word
	known   bool
}

func findExecCommands(args []*syntax.Word) []staticNestedCommand {
	commands := make([]staticNestedCommand, 0)
	for index := 0; index < len(args); index++ {
		operator, ok := safeStaticWord(args[index])
		if !ok || !oneOfString(operator, "-exec", "-execdir", "-ok", "-okdir") {
			continue
		}
		if index+1 >= len(args) {
			commands = append(commands, staticNestedCommand{})
			break
		}
		programValue, ok := safeStaticWord(args[index+1])
		if !ok {
			commands = append(commands, staticNestedCommand{})
			continue
		}
		end := index + 2
		for end < len(args) {
			value, static := safeStaticWord(args[end])
			if static && (value == ";" || value == "+") {
				break
			}
			end++
		}
		program := safeProgramName(programValue)
		commands = append(commands, staticNestedCommand{program: program, args: args[index+2 : end], known: program != "dynamic"})
		index = end
	}
	return commands
}

func oneOfString(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func (c *commandFactsCollector) visitPipeline(binary *syntax.BinaryCmd) {
	left, leftOK := commandProgram(binary.X)
	right, rightOK := commandProgram(binary.Y)
	if leftOK && (left == "curl" || left == "wget") {
		c.effect("network-access")
	}
	if leftOK && (left == "curl" || left == "wget") && rightOK && isShellProgram(right) {
		c.effect("shell-execution")
		c.danger("network-pipe-shell")
	}
}

func (c *commandFactsCollector) effect(label string) {
	c.effects[label] = struct{}{}
}

func (c *commandFactsCollector) danger(label string) {
	c.dangerous[label] = struct{}{}
}

func (c *commandFactsCollector) finish() {
	c.facts.Effects = sortedFactLabels(c.effects)
	c.facts.Dangerous = sortedFactLabels(c.dangerous)
}

func commandProgram(stmt *syntax.Stmt) (string, bool) {
	if stmt == nil {
		return "", false
	}
	call, ok := stmt.Cmd.(*syntax.CallExpr)
	if !ok || len(call.Args) == 0 {
		return "", false
	}
	program, ok := safeStaticWord(call.Args[0])
	if !ok {
		return "", false
	}
	return safeProgramName(program), true
}

func safeStaticWord(word *syntax.Word) (string, bool) {
	if word == nil || len(word.Parts) == 0 {
		return "", false
	}
	var value strings.Builder
	for _, part := range word.Parts {
		switch part := part.(type) {
		case *syntax.Lit:
			value.WriteString(part.Value)
		case *syntax.SglQuoted:
			value.WriteString(part.Value)
		case *syntax.DblQuoted:
			for _, quotedPart := range part.Parts {
				literal, ok := quotedLiteralPart(quotedPart)
				if !ok {
					return "", false
				}
				value.WriteString(literal)
			}
		default:
			return "", false
		}
	}
	return value.String(), true
}

func quotedLiteralPart(part syntax.WordPart) (string, bool) {
	switch part := part.(type) {
	case *syntax.Lit:
		return part.Value, true
	case *syntax.SglQuoted:
		return part.Value, true
	default:
		return "", false
	}
}

const maxCommandFactProgramBytes = 64

func safeProgramName(program string) string {
	program = filepath.Base(strings.TrimSpace(program))
	if program == "." || program == string(filepath.Separator) {
		return "dynamic"
	}
	if len(program) == 0 || len(program) > maxCommandFactProgramBytes || !safeProgramToken(program) {
		return "other"
	}
	return program
}

func safeProgramToken(program string) bool {
	for index := 0; index < len(program); index++ {
		char := program[index]
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' {
			continue
		}
		if index > 0 && (char == '.' || char == '_' || char == '+' || char == '-') {
			continue
		}
		return false
	}
	return true
}

func isSubcommandProgram(program string) bool {
	switch program {
	case "git", "go", "npm", "pnpm", "yarn", "bun":
		return true
	default:
		return false
	}
}

func stableSubcommand(program, subcommand string) string {
	allowed := map[string]map[string]struct{}{
		"git":  {"add": {}, "branch": {}, "checkout": {}, "clean": {}, "clone": {}, "commit": {}, "config": {}, "diff": {}, "fetch": {}, "log": {}, "merge": {}, "pull": {}, "push": {}, "reset": {}, "restore": {}, "show": {}, "status": {}, "switch": {}, "tag": {}},
		"go":   {"build": {}, "clean": {}, "env": {}, "fmt": {}, "generate": {}, "get": {}, "install": {}, "list": {}, "mod": {}, "run": {}, "test": {}, "tool": {}, "vet": {}, "version": {}, "work": {}},
		"npm":  {"ci": {}, "exec": {}, "install": {}, "run": {}, "test": {}, "update": {}},
		"pnpm": {"add": {}, "build": {}, "install": {}, "lint": {}, "run": {}, "test": {}, "update": {}},
		"yarn": {"add": {}, "build": {}, "install": {}, "lint": {}, "run": {}, "test": {}, "upgrade": {}},
		"bun":  {"add": {}, "build": {}, "install": {}, "run": {}, "test": {}, "update": {}},
	}
	if _, ok := allowed[program][subcommand]; ok {
		return subcommand
	}
	return "other"
}

func isShellProgram(program string) bool {
	switch program {
	case "sh", "dash", "bash", "zsh", "ksh":
		return true
	default:
		return false
	}
}

func hasStaticArgument(args []*syntax.Word, want string) bool {
	for _, arg := range args {
		if value, ok := safeStaticWord(arg); ok && value == want {
			return true
		}
	}
	return false
}

func hasForceArgument(args []*syntax.Word) bool {
	for _, arg := range args {
		if value, ok := safeStaticWord(arg); ok && (value == "-f" || strings.HasPrefix(value, "-f") || value == "--force") {
			return true
		}
	}
	return false
}

func hasRecursiveArgument(args []*syntax.Word) bool {
	for _, arg := range args {
		value, ok := safeStaticWord(arg)
		if !ok {
			continue
		}
		if value == "--" {
			return false
		}
		if value == "--recursive" || value == "-R" || value == "-r" {
			return true
		}
		if strings.HasPrefix(value, "-") && !strings.HasPrefix(value, "--") && strings.ContainsAny(value[1:], "Rr") {
			return true
		}
	}
	return false
}

func truncatesRedirect(redirect *syntax.Redirect) bool {
	switch redirect.Op.String() {
	case ">", ">|":
		return true
	default:
		return false
	}
}

func sortedFactLabels(labels map[string]struct{}) []string {
	if len(labels) == 0 {
		return nil
	}
	out := make([]string, 0, len(labels))
	for label := range labels {
		out = append(out, label)
	}
	sort.Strings(out)
	return out
}

func mergeFactLabels(left, right []string) []string {
	labels := make(map[string]struct{}, len(left)+len(right))
	for _, label := range left {
		labels[label] = struct{}{}
	}
	for _, label := range right {
		labels[label] = struct{}{}
	}
	return sortedFactLabels(labels)
}

func commandDangerWarningFromFacts(facts CommandFacts) string {
	for _, dangerous := range facts.Dangerous {
		if warning := commandDangerWarning(dangerous); warning != "" {
			return warning
		}
	}
	return ""
}

func commandDangerWarning(dangerous string) string {
	switch dangerous {
	case "file-delete":
		return "Delete commands permanently remove files or directories and cannot run automatically under the current safety policy."
	case "privilege-escalation", "disk-write":
		return "Privileged or disk-level commands are too risky to run automatically under the current safety policy."
	case "disk-format":
		return "Disk-formatting commands are too risky to run automatically under the current safety policy."
	case "file-destroy":
		return "shred destroys file contents and cannot run automatically under the current safety policy."
	case "find-delete":
		return "find -delete can remove files in bulk and cannot run automatically under the current safety policy."
	case "git-clean":
		return "git clean -f deletes untracked files and cannot run automatically under the current safety policy."
	case "git-reset-hard":
		return "git reset --hard discards local changes and cannot run automatically under the current safety policy."
	case "network-pipe-shell":
		return "Piping curl or wget into a shell is too risky to run automatically under the current safety policy."
	case "permission-weaken":
		return "Recursive chmod 777 weakens permissions broadly and cannot run automatically under the current safety policy."
	case "file-truncate":
		return "Shell redirection can truncate files and cannot run automatically under the current safety policy."
	default:
		return ""
	}
}
