package gitlock

import (
	"path/filepath"
	"strings"
	"sync"
)

type Manager struct {
	mu    sync.Mutex
	locks map[string]*repoLock
}

type repoLock struct {
	mu   sync.Mutex
	refs int
}

func New() *Manager {
	return &Manager{locks: make(map[string]*repoLock)}
}

var Default = New()

func (m *Manager) Lock(repoRoot string) func() {
	key := lockKey(repoRoot)
	m.mu.Lock()
	lock := m.locks[key]
	if lock == nil {
		lock = &repoLock{}
		m.locks[key] = lock
	}
	lock.refs++
	m.mu.Unlock()

	lock.mu.Lock()
	return func() {
		lock.mu.Unlock()
		m.mu.Lock()
		lock.refs--
		if lock.refs == 0 {
			delete(m.locks, key)
		}
		m.mu.Unlock()
	}
}

func lockKey(repoRoot string) string {
	repoRoot = strings.TrimSpace(repoRoot)
	if absolute, err := filepath.Abs(repoRoot); err == nil {
		repoRoot = absolute
	}
	if resolved, err := filepath.EvalSymlinks(repoRoot); err == nil {
		repoRoot = resolved
	}
	return filepath.Clean(repoRoot)
}
