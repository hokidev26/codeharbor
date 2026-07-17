package background

import (
	"context"
	"errors"
	"sync"

	"autoto/internal/db"
)

type taskOutputStore interface {
	AppendBackgroundTaskOutput(context.Context, string, string, []byte, int64) (db.BackgroundTaskOutputAppendResult, error)
}

type persistentOutputWriter struct {
	ctx       context.Context
	store     taskOutputStore
	taskID    string
	maxBytes  int64
	chunkSize int
	onAppend  func(db.BackgroundTaskOutputAppendResult)

	mu        sync.Mutex
	truncated bool
}

func newPersistentOutputWriter(ctx context.Context, store taskOutputStore, taskID string, maxBytes int64, chunkSize int, onAppend func(db.BackgroundTaskOutputAppendResult)) *persistentOutputWriter {
	return &persistentOutputWriter{ctx: ctx, store: store, taskID: taskID, maxBytes: maxBytes, chunkSize: chunkSize, onAppend: onAppend}
}

func (writer *persistentOutputWriter) Write(stream string, chunk []byte) error {
	if len(chunk) == 0 {
		return nil
	}
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.truncated {
		return nil
	}
	for len(chunk) > 0 {
		size := len(chunk)
		if size > writer.chunkSize {
			size = writer.chunkSize
		}
		result, err := writer.store.AppendBackgroundTaskOutput(writer.ctx, writer.taskID, stream, chunk[:size], writer.maxBytes)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			return err
		}
		writer.truncated = result.Truncated
		if writer.onAppend != nil {
			writer.onAppend(result)
		}
		if writer.truncated {
			return nil
		}
		chunk = chunk[size:]
	}
	return nil
}

func (writer *persistentOutputWriter) Truncated() bool {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.truncated
}
