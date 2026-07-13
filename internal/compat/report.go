package compat

import "sync"

const RemovalVersion = "v0.4.0"

type Usage struct {
	Key         string
	Legacy      string
	Replacement string
	Kind        string
}

type Report struct {
	Usages []Usage
}

func (r *Report) Add(usage Usage) {
	if usage.Key == "" {
		return
	}
	for _, existing := range r.Usages {
		if existing.Key == usage.Key {
			return
		}
	}
	r.Usages = append(r.Usages, usage)
}

func (r Report) Empty() bool {
	return len(r.Usages) == 0
}

func (r Report) LegacyNames() []string {
	out := make([]string, 0, len(r.Usages))
	for _, usage := range r.Usages {
		out = append(out, usage.Legacy)
	}
	return out
}

func (r Report) Replacements() []string {
	out := make([]string, 0, len(r.Usages))
	for _, usage := range r.Usages {
		out = append(out, usage.Replacement)
	}
	return out
}

type Registry struct {
	mu   sync.Mutex
	seen map[string]struct{}
	warn func(Usage)
}

func NewRegistry(warn func(Usage)) *Registry {
	return &Registry{seen: make(map[string]struct{}), warn: warn}
}

func (r *Registry) Warn(usage Usage) bool {
	if r == nil || usage.Key == "" {
		return false
	}
	r.mu.Lock()
	if _, ok := r.seen[usage.Key]; ok {
		r.mu.Unlock()
		return false
	}
	r.seen[usage.Key] = struct{}{}
	warn := r.warn
	r.mu.Unlock()
	if warn != nil {
		warn(usage)
	}
	return true
}
