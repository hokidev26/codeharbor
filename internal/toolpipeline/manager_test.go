package toolpipeline

import (
	"strings"
	"testing"
	"time"

	"autoto/internal/tools"
)

func TestManagerCapturesAliasesAndEndsWithFilteredOutput(t *testing.T) {
	manager := NewManager()
	scope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	started := manager.Start(scope, tools.ToolOutputPipelineStartOptions{Label: "failures", MaxPreviewChars: 40})
	if started.IsError || !manager.IsActive(scope) {
		t.Fatalf("pipeline did not start: %+v", started)
	}
	first := manager.ProcessResult(scope, tools.Call{ID: "read-1", Name: "Read"}, tools.Result{Output: "ok\nERROR alpha\n"})
	second := manager.ProcessResult(scope, tools.Call{ID: "grep-1", Name: "Grep"}, tools.Result{Output: "failed beta\nok\n"})
	if !strings.Contains(first.Output, "Captured as p1") || !strings.Contains(second.Output, "Captured as p2") {
		t.Fatalf("unexpected aliases: first=%q second=%q", first.Output, second.Output)
	}
	ended := manager.End(scope, tools.ToolOutputPipelineEndOptions{Rule: `from p1 p2 | grep -i "error|failed" | sort`, Format: "plain"})
	if ended.IsError {
		t.Fatalf("pipeline end failed: %+v", ended)
	}
	if !strings.Contains(ended.Output, "ERROR alpha\nfailed beta") || manager.IsActive(scope) {
		t.Fatalf("unexpected pipeline result: %q active=%v", ended.Output, manager.IsActive(scope))
	}
}

func TestManagerRuleFailureKeepsPipelineActive(t *testing.T) {
	manager := NewManager()
	scope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	manager.Start(scope, tools.ToolOutputPipelineStartOptions{})
	manager.ProcessResult(scope, tools.Call{ID: "read-1", Name: "Read"}, tools.Result{Output: "alpha"})
	failed := manager.End(scope, tools.ToolOutputPipelineEndOptions{Rule: `from p9 | head -n 1`})
	if !failed.IsError || !strings.Contains(failed.Output, "pipeline_alias_not_found") || !manager.IsActive(scope) {
		t.Fatalf("invalid end should preserve state: %+v active=%v", failed, manager.IsActive(scope))
	}
	succeeded := manager.End(scope, tools.ToolOutputPipelineEndOptions{Rule: `from p1 | cat`})
	if succeeded.IsError || manager.IsActive(scope) {
		t.Fatalf("retry did not finish pipeline: %+v", succeeded)
	}
}

func TestManagerIsolatesRunsAndBypassesControlTools(t *testing.T) {
	manager := NewManager()
	firstScope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	secondScope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-2"}
	manager.Start(firstScope, tools.ToolOutputPipelineStartOptions{})
	control := tools.Result{Output: "control result"}
	if got := manager.ProcessResult(firstScope, tools.Call{Name: tools.EndPipelineToolName}, control); got.Output != control.Output {
		t.Fatalf("control tool result was captured: %+v", got)
	}
	if got := manager.ProcessResult(secondScope, tools.Call{Name: "Read"}, tools.Result{Output: "raw"}); got.Output != "raw" {
		t.Fatalf("another run was captured: %+v", got)
	}
	manager.CloseRun(firstScope)
	if manager.IsActive(firstScope) {
		t.Fatal("pipeline remained active after CloseRun")
	}
}

func TestManagerLimitsDoNotLeakRawOutput(t *testing.T) {
	manager := NewManagerWithLimits(Limits{MaxCaptures: 1, MaxTotalBytes: 8, MinPreview: 4, MaxPreview: 20, DefaultPreview: 8, DefaultResult: 100, MaxResult: 100, IdleTTL: time.Minute})
	scope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	manager.Start(scope, tools.ToolOutputPipelineStartOptions{})
	manager.ProcessResult(scope, tools.Call{Name: "Read"}, tools.Result{Output: "first"})
	secret := "TOP_SECRET_CONTENT_THAT_MUST_NOT_BE_RETURNED"
	limited := manager.ProcessResult(scope, tools.Call{Name: "Grep"}, tools.Result{Output: secret})
	if !strings.Contains(limited.Output, "pipeline_limit_exceeded") || strings.Contains(limited.Output, secret) {
		t.Fatalf("capture limit leaked raw output: %q", limited.Output)
	}
}

func TestManagerRequiresDurableRunAndSupportsDiscard(t *testing.T) {
	manager := NewManager()
	missing := manager.Start(tools.ToolOutputPipelineScope{AgentID: "agent-1"}, tools.ToolOutputPipelineStartOptions{})
	if !missing.IsError || !strings.Contains(missing.Output, "pipeline_run_required") {
		t.Fatalf("missing run was accepted: %+v", missing)
	}
	scope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	manager.Start(scope, tools.ToolOutputPipelineStartOptions{})
	discarded := manager.End(scope, tools.ToolOutputPipelineEndOptions{Discard: true})
	if discarded.IsError || manager.IsActive(scope) || !strings.Contains(discarded.Output, "discarded") {
		t.Fatalf("discard failed: %+v", discarded)
	}
}

func TestManagerExpiresIdlePipelines(t *testing.T) {
	manager := NewManagerWithLimits(Limits{IdleTTL: time.Second})
	now := time.Unix(100, 0)
	manager.now = func() time.Time { return now }
	scope := tools.ToolOutputPipelineScope{AgentID: "agent-1", RunID: "run-1"}
	manager.Start(scope, tools.ToolOutputPipelineStartOptions{})
	now = now.Add(2 * time.Second)
	if manager.IsActive(scope) {
		t.Fatal("expired pipeline remained active")
	}
}
