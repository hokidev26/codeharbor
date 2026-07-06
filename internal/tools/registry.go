package tools

import (
	"errors"
	"sync"
)

type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

func NewRegistry() *Registry {
	return &Registry{tools: make(map[string]Tool)}
}

func (r *Registry) Register(tool Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[tool.Name()] = tool
}

func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tool, ok := r.tools[name]
	return tool, ok
}

func (r *Registry) List() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Tool, 0, len(r.tools))
	for _, tool := range r.tools {
		out = append(out, tool)
	}
	return out
}

func (r *Registry) MustGet(name string) (Tool, error) {
	tool, ok := r.Get(name)
	if !ok {
		return nil, errors.New("tool not found: " + name)
	}
	return tool, nil
}

func RegisterCore(registry *Registry) {
	registry.Register(ReadTool{})
	registry.Register(WriteTool{})
	registry.Register(EditTool{})
	registry.Register(BashTool{})
	registry.Register(GlobTool{})
	registry.Register(GrepTool{})
}
