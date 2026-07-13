package preview

import (
	"bytes"
	"strings"
	"sync"
)

const (
	maxLogLines       = 1000
	maxLogBytes       = 2 << 20
	maxLogLineBytes   = 32 << 10
	maxAPILogLines    = 200
	maxAPILogBytes    = 40 << 10
	truncatedLogLabel = "... [truncated]"
)

type LogLine struct {
	Stream string `json:"stream"`
	Line   string `json:"line"`
}

type Logs struct {
	Lines []LogLine `json:"lines"`
}

type logRing struct {
	mu    sync.Mutex
	lines []LogLine
	bytes int
}

func (r *logRing) add(stream, line string) {
	line = strings.TrimSuffix(line, "\r")
	entry := LogLine{Stream: stream, Line: line}
	size := len(entry.Stream) + len(entry.Line)

	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, entry)
	r.bytes += size
	for len(r.lines) > maxLogLines || r.bytes > maxLogBytes {
		oldest := r.lines[0]
		r.bytes -= len(oldest.Stream) + len(oldest.Line)
		r.lines[0] = LogLine{}
		r.lines = r.lines[1:]
	}
}

func (r *logRing) snapshot() Logs {
	r.mu.Lock()
	defer r.mu.Unlock()

	start := len(r.lines)
	bytesUsed := 0
	for start > 0 && len(r.lines)-start < maxAPILogLines {
		candidate := r.lines[start-1]
		size := len(candidate.Stream) + len(candidate.Line)
		if bytesUsed+size > maxAPILogBytes {
			break
		}
		bytesUsed += size
		start--
	}
	lines := append([]LogLine(nil), r.lines[start:]...)
	if lines == nil {
		lines = []LogLine{}
	}
	return Logs{Lines: lines}
}

type lineWriter struct {
	mu        sync.Mutex
	stream    string
	ring      *logRing
	scrub     func(string) string
	buffer    []byte
	truncated bool
}

func (w *lineWriter) Write(data []byte) (int, error) {
	written := len(data)
	w.mu.Lock()
	defer w.mu.Unlock()
	for len(data) > 0 {
		newline := bytes.IndexByte(data, '\n')
		chunk := data
		complete := false
		if newline >= 0 {
			chunk = data[:newline]
			complete = true
		}
		w.appendChunk(chunk)
		if complete {
			w.emitLocked()
			data = data[newline+1:]
		} else {
			break
		}
	}
	return written, nil
}

func (w *lineWriter) appendChunk(chunk []byte) {
	remaining := maxLogLineBytes - len(truncatedLogLabel) - len(w.buffer)
	if remaining > 0 {
		if len(chunk) > remaining {
			w.buffer = append(w.buffer, chunk[:remaining]...)
			w.truncated = true
		} else {
			w.buffer = append(w.buffer, chunk...)
		}
	}
	if len(chunk) > remaining {
		w.truncated = true
	}
}

func (w *lineWriter) flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.buffer) > 0 || w.truncated {
		w.emitLocked()
	}
}

func (w *lineWriter) emitLocked() {
	line := string(w.buffer)
	if w.truncated {
		line += truncatedLogLabel
	}
	if w.scrub != nil {
		line = w.scrub(line)
	}
	w.ring.add(w.stream, line)
	w.buffer = w.buffer[:0]
	w.truncated = false
}
