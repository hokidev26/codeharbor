package agent

import (
	"testing"
)

func TestToolInputSchemaBuildsNestedObjectsAndArrays(t *testing.T) {
	type child struct {
		Name string `json:"name"`
	}
	type input struct {
		Child    child           `json:"child"`
		Children []child         `json:"children,omitempty"`
		Options  map[string]bool `json:"options,omitempty"`
	}
	schema := toolInputSchema(input{})
	properties := schema["properties"].(map[string]any)
	childSchema := properties["child"].(map[string]any)
	if childSchema["type"] != "object" || childSchema["properties"].(map[string]any)["name"].(map[string]any)["type"] != "string" {
		t.Fatalf("nested struct schema was not recursive: %+v", schema)
	}
	childrenSchema := properties["children"].(map[string]any)
	if childrenSchema["type"] != "array" || childrenSchema["items"].(map[string]any)["type"] != "object" {
		t.Fatalf("nested array schema was not recursive: %+v", schema)
	}
	if properties["options"].(map[string]any)["type"] != "object" {
		t.Fatalf("map schema should remain an object: %+v", schema)
	}
}
