//go:build windows

package process

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// Windows Job Object constants (process-group equivalent for managed trees).
const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x2000
	createNewProcessGroup             = 0x00000200
)

type windowsGroup struct {
	mu  sync.Mutex
	job syscall.Handle
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func preparePlatform(cmd *exec.Cmd) platformGroup {
	// CREATE_NEW_PROCESS_GROUP keeps console control behavior predictable;
	// the Job Object is what reaps the full tree on close.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
	return &windowsGroup{}
}

func (g *windowsGroup) started(cmd *exec.Cmd) error {
	if g == nil || cmd == nil || cmd.Process == nil {
		return nil
	}
	job, err := createKillOnCloseJob()
	if err != nil {
		return err
	}
	if err := assignProcessToJob(job, cmd.Process.Pid); err != nil {
		_ = syscall.CloseHandle(job)
		return err
	}
	g.mu.Lock()
	g.job = job
	g.mu.Unlock()
	return nil
}

func (g *windowsGroup) terminate(cmd *exec.Cmd, done <-chan error, grace time.Duration) error {
	// Prefer job-level kill so grandchildren exit with the shell.
	_ = g.kill(cmd)
	if done == nil {
		return nil
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		_ = g.kill(cmd)
		return <-done
	}
}

func (g *windowsGroup) kill(cmd *exec.Cmd) error {
	g.mu.Lock()
	job := g.job
	g.mu.Unlock()
	if job != 0 {
		// Closing the job with KILL_ON_JOB_CLOSE terminates members.
		g.mu.Lock()
		if g.job == job {
			g.job = 0
		}
		g.mu.Unlock()
		return syscall.CloseHandle(job)
	}
	if cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

func (g *windowsGroup) close() error {
	return g.kill(nil)
}

func createKillOnCloseJob() (syscall.Handle, error) {
	job, err := syscall.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("create job object: %w", err)
	}
	var info jobObjectExtendedLimitInformation
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	if err := setJobInformation(job, jobObjectExtendedLimitInformation, unsafe.Pointer(&info), uint32(unsafe.Sizeof(info))); err != nil {
		_ = syscall.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

func setJobInformation(job syscall.Handle, class uint32, info unsafe.Pointer, length uint32) error {
	r1, _, err := syscall.NewLazyDLL("kernel32.dll").NewProc("SetInformationJobObject").Call(
		uintptr(job),
		uintptr(class),
		uintptr(info),
		uintptr(length),
	)
	if r1 == 0 {
		if err != nil {
			return fmt.Errorf("SetInformationJobObject: %w", err)
		}
		return fmt.Errorf("SetInformationJobObject failed")
	}
	return nil
}

func assignProcessToJob(job syscall.Handle, pid int) error {
	handle, err := syscall.OpenProcess(syscall.PROCESS_SET_QUOTA|syscall.PROCESS_TERMINATE|syscall.PROCESS_DUP_HANDLE|0x0400 /*PROCESS_QUERY_INFORMATION*/, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("OpenProcess: %w", err)
	}
	defer syscall.CloseHandle(handle)
	r1, _, callErr := syscall.NewLazyDLL("kernel32.dll").NewProc("AssignProcessToJobObject").Call(uintptr(job), uintptr(handle))
	if r1 == 0 {
		if callErr != nil {
			return fmt.Errorf("AssignProcessToJobObject: %w", callErr)
		}
		return fmt.Errorf("AssignProcessToJobObject failed")
	}
	return nil
}
