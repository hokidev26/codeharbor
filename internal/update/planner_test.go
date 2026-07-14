package update

import (
	"errors"
	"fmt"
	"testing"
)

func TestPlannerSingleEdgeSupportsVPrefixAndPrerelease(t *testing.T) {
	manifest := Manifest{
		SchemaVersion: CurrentSchemaVersion,
		Channel:       "beta",
		Edges: []Edge{{
			SourceVersion:  "v1.0.0-beta.1",
			TargetVersion:  "1.0.0",
			DB:             SchemaTransition{From: 4, To: 4},
			Config:         SchemaTransition{From: 2, To: 2},
			Preferences:    SchemaTransition{From: 3, To: 3},
			RequiresBackup: true,
			Notes:          Notes{"Promote the tested prerelease."},
		}},
	}

	plan, err := BuildPlan(manifest, "1.0.0-beta.1", "", "beta")
	if err != nil {
		t.Fatal(err)
	}
	if plan.CurrentVersion != "1.0.0-beta.1" || plan.TargetVersion != "1.0.0" || len(plan.Steps) != 1 {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	if !plan.RequiresBackup || plan.RequiresRestart {
		t.Fatalf("unexpected aggregate requirements: %+v", plan)
	}
}

func TestPlannerMultiEdgePathAggregatesRequirements(t *testing.T) {
	manifest := Manifest{
		Channel: "stable",
		Edges: []Edge{
			{
				SourceVersion:  "v1.0.0",
				TargetVersion:  "1.1.0",
				DB:             SchemaTransition{From: 1, To: 2},
				Config:         SchemaTransition{From: 5, To: 5},
				Preferences:    SchemaTransition{From: 7, To: 8},
				RequiresBackup: true,
				Notes:          Notes{"Migrate the database and preferences schemas."},
			},
			{
				SourceVersion:   "1.1.0",
				TargetVersion:   "v1.2.0",
				DB:              SchemaTransition{From: 2, To: 2},
				Config:          SchemaTransition{From: 5, To: 6},
				Preferences:     SchemaTransition{From: 8, To: 8},
				RequiresRestart: true,
				Notes:           Notes{"Activate the new configuration schema."},
			},
		},
	}

	planner, err := NewPlanner(manifest)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planner.Plan("1.0.0", "1.2.0", "stable")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Steps) != 2 || plan.Steps[0].TargetVersion != "1.1.0" || plan.Steps[1].TargetVersion != "v1.2.0" {
		t.Fatalf("unexpected steps: %+v", plan.Steps)
	}
	if !plan.RequiresBackup || !plan.RequiresRestart {
		t.Fatalf("expected aggregated backup and restart requirements: %+v", plan)
	}
}

func TestValidateManifestRejectsCycle(t *testing.T) {
	manifest := Manifest{Channel: "stable", Edges: []Edge{
		testEdge("1.0.0", "1.1.0"),
		testEdge("1.1.0", "1.0.0"),
	}}
	if err := ValidateManifest(manifest); !errors.Is(err, ErrCycle) {
		t.Fatalf("expected cycle rejection, got %v", err)
	}
}

func TestValidateManifestRejectsBrokenPath(t *testing.T) {
	manifest := Manifest{Channel: "stable", Edges: []Edge{
		testEdge("1.0.0", "1.1.0"),
		testEdge("1.2.0", "1.3.0"),
	}}
	if err := ValidateManifest(manifest); !errors.Is(err, ErrBrokenPath) {
		t.Fatalf("expected broken path rejection, got %v", err)
	}
}

func TestValidateManifestRejectsDowngrade(t *testing.T) {
	manifest := Manifest{Channel: "stable", Edges: []Edge{testEdge("2.0.0", "1.9.0")}}
	if err := ValidateManifest(manifest); !errors.Is(err, ErrDowngrade) {
		t.Fatalf("expected downgrade rejection, got %v", err)
	}
}

func TestValidateManifestRejectsDuplicateEdge(t *testing.T) {
	edge := testEdge("1.0.0", "1.1.0")
	manifest := Manifest{Channel: "stable", Edges: []Edge{edge, edge}}
	if err := ValidateManifest(manifest); !errors.Is(err, ErrDuplicateEdge) {
		t.Fatalf("expected duplicate edge rejection, got %v", err)
	}
}

func TestParseManifestRejectsScriptURLAndCommandFields(t *testing.T) {
	for _, field := range []string{"script", "downloadURL", "command"} {
		t.Run(field, func(t *testing.T) {
			data := fmt.Sprintf(`{
				"channel":"stable",
				"edges":[{
					"sourceVersion":"1.0.0",
					"targetVersion":"1.1.0",
					"db":{"from":1,"to":1},
					"config":{"from":1,"to":1},
					"preferences":{"from":1,"to":1},
					"requiresBackup":false,
					"requiresRestart":false,
					"%s":"unsafe"
				}]
			}`, field)
			if _, err := ParseManifest([]byte(data)); !errors.Is(err, ErrUnsafeField) {
				t.Fatalf("expected unsafe field rejection, got %v", err)
			}
		})
	}
}

func testEdge(source, target string) Edge {
	return Edge{
		SourceVersion: source,
		TargetVersion: target,
		DB:            SchemaTransition{From: 1, To: 1},
		Config:        SchemaTransition{From: 1, To: 1},
		Preferences:   SchemaTransition{From: 1, To: 1},
	}
}
