//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris

package preview

import (
	"context"
	"errors"
	"os/exec"
)

var errDynamicUnsupported = errors.New("dynamic previews are not supported on this platform")

func dynamicSupported() bool { return false }

func prepareDynamicProcess(*exec.Cmd) {}

func terminateDynamicProcess(*exec.Cmd) error { return errDynamicUnsupported }

func killDynamicProcess(*exec.Cmd) error { return errDynamicUnsupported }

func validateLoopbackListener(context.Context, int) error { return errDynamicUnsupported }
