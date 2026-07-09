package tools

import (
	"context"
	"encoding/json"

	"codeharbor/internal/db"
)

type Risk string

const (
	RiskRead   Risk = "read"
	RiskWrite  Risk = "write"
	RiskExec   Risk = "exec"
	RiskDanger Risk = "danger"
)

type Call struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type Result struct {
	Output  string         `json:"output"`
	IsError bool           `json:"isError,omitempty"`
	Meta    map[string]any `json:"meta,omitempty"`
}

type OutputChunk struct {
	Text      string
	Stream    string
	Truncated bool
}

type Env struct {
	NarratorID string
	CWD        string
	Store      *db.Store
	Output     func(OutputChunk)
}

type Tool interface {
	Name() string
	Description() string
	Schema() any
	Risk(input json.RawMessage) Risk
	Execute(ctx context.Context, call Call, env Env) (Result, error)
}
