package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"autoto/internal/background"
	"autoto/internal/db"
	"autoto/internal/review"
	"autoto/internal/tools"
)

func TestWorkStateSecuritySnapshotOmitsPrivateExecutionState(t *testing.T) {
	store, app, agentRecord := newStreamRecoveryServer(t)
	defer store.Close()
	ctx := context.Background()

	const secret = "WORK_STATE_PRIVATE_SENTINEL_7f4c"
	if _, err := store.DB().ExecContext(ctx, `UPDATE agents SET context_summary = ? WHERE id = ?`, secret, agentRecord.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{
		AgentID:           agentRecord.ID,
		Role:              "assistant",
		ContentText:       "safe durable progress",
		ProviderStateJSON: json.RawMessage(`{"private":"` + secret + `"}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAgent(ctx, db.Agent{
		WorklineID:        agentRecord.WorklineID,
		ParentAgentID:     agentRecord.ID,
		Type:              "subagent",
		SubagentType:      "reviewer",
		Title:             "safe reviewer",
		Model:             agentRecord.Model,
		SystemPrompt:      secret,
		PermissionMode:    "readOnly",
		ExecutionDeviceID: agentRecord.ExecutionDeviceID,
		Status:            "idle",
		CWD:               agentRecord.CWD,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSpecTask(ctx, db.SpecTask{AgentID: agentRecord.ID, Text: "run focused checks", Status: "doing"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreatePlan(ctx, db.Plan{
		AgentID: agentRecord.ID,
		Status:  db.PlanStatusDraft,
		ContentJSON: mustWorkStateJSON(t, review.PlanDraft{
			Goal:  "add safe work state",
			Steps: []string{"project bounded state"},
			Tests: []string{"go test ./internal/server -run TestWorkState"},
		}),
	}); err != nil {
		t.Fatal(err)
	}

	manager := background.NewManager(store, background.Options{})
	service := background.NewService(manager, store)
	if _, err := service.Submit(ctx, tools.BackgroundTaskRequest{
		Kind:          tools.BackgroundTaskKindAgent,
		OwnerAgentID:  agentRecord.ID,
		Payload:       json.RawMessage(`{"prompt":"` + secret + `"}`),
		PublicSummary: json.RawMessage(`{"description":"safe task"}`),
	}); err != nil {
		t.Fatal(err)
	}
	app.SetBackgroundTaskService(service)

	response := httptest.NewRecorder()
	app.Routes().ServeHTTP(response, newTestRequest(http.MethodGet, "/api/v2/agents/"+agentRecord.ID+"/live-snapshot", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), secret) {
		t.Fatalf("live snapshot leaked private execution data: %s", response.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	workState, ok := payload["workState"].(map[string]any)
	if !ok {
		t.Fatalf("additive live snapshot did not include workState: %s", response.Body.String())
	}
	for _, forbidden := range []string{
		"payloadJson", "payload", "providerStateJson", "contextSummary", "systemPrompt",
		"workerInstanceId", "permissionModeCap", "permissionGenerationSnapshot",
		"policyGenerationSnapshot", "agentGenerationSnapshot", "toolCatalogDigest", "workspaceFingerprint",
	} {
		if workStateContainsJSONKey(workState, forbidden) {
			t.Fatalf("workState exposed sensitive field %q: %+v", forbidden, workState)
		}
	}
}

func TestWorkStateVerificationDeclaredTestsRemainDeclared(t *testing.T) {
	plan := db.Plan{ContentJSON: mustWorkStateJSON(t, review.PlanDraft{
		Goal:  "verify without overstating evidence",
		Tests: []string{"go test ./internal/server -run TestWorkState"},
	})}
	summary := summarizeReviewPlan(plan)
	if len(summary.Tests) != 1 {
		t.Fatalf("declared test projection = %+v, want one item", summary.Tests)
	}
	if summary.Tests[0].Text != "go test ./internal/server -run TestWorkState" || summary.Tests[0].Status != "declared" {
		t.Fatalf("declared test was projected as execution evidence: %+v", summary.Tests[0])
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(encoded)), `"status":"passed"`) {
		t.Fatalf("declared tests were mislabeled as passed: %s", encoded)
	}
}

func TestWorkStateLegacyLiveSnapshotDecodesWithoutAdditiveFields(t *testing.T) {
	legacy := []byte(`{
		"protocol":1,
		"agent":{"id":"legacy-agent","type":"main","title":"legacy","model":"fake:test","permissionMode":"readOnly","entityGeneration":1,"permissionGeneration":1,"executionGeneration":0,"fastMode":false,"executionDeviceId":"local","status":"idle","planMode":false,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
		"messages":[],
		"messageHasMoreBefore":false,
		"pendingApprovals":[],
		"generations":{"entity":1,"permission":1,"execution":0,"policy":1},
		"executionGeneration":0,
		"review":{"reviewModel":"","reviewerReady":false,"runnerIntegrated":false,"planCount":0},
		"stream":{"protocol":1,"streamSession":"legacy","latestSequence":0}
	}`)
	var snapshot agentLiveSnapshotResponse
	if err := json.Unmarshal(legacy, &snapshot); err != nil {
		t.Fatalf("legacy live snapshot no longer decodes: %v", err)
	}
	if snapshot.Agent.ID != "legacy-agent" || snapshot.ExecutionGeneration != 0 || len(snapshot.Messages) != 0 {
		t.Fatalf("legacy snapshot fields were not preserved: %+v", snapshot)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"workState"`) {
		t.Fatalf("decoding an old snapshot fabricated additive work state: %s", encoded)
	}
}

func mustWorkStateJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func workStateContainsJSONKey(value any, target string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if strings.EqualFold(key, target) || workStateContainsJSONKey(child, target) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if workStateContainsJSONKey(child, target) {
				return true
			}
		}
	}
	return false
}
