package gitlock

import (
	"testing"
	"time"
)

func TestManagerSerializesSameRepository(t *testing.T) {
	manager := New()
	unlock := manager.Lock("/tmp/repo")
	acquired := make(chan struct{})
	go func() {
		secondUnlock := manager.Lock("/tmp/repo")
		close(acquired)
		secondUnlock()
	}()
	select {
	case <-acquired:
		t.Fatal("same repository lock acquired before release")
	case <-time.After(25 * time.Millisecond):
	}
	unlock()
	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("same repository lock did not acquire after release")
	}
}

func TestManagerAllowsDifferentRepositories(t *testing.T) {
	manager := New()
	unlock := manager.Lock("/tmp/repo-one")
	defer unlock()
	acquired := make(chan struct{})
	go func() {
		secondUnlock := manager.Lock("/tmp/repo-two")
		close(acquired)
		secondUnlock()
	}()
	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("different repository lock was unnecessarily blocked")
	}
}
