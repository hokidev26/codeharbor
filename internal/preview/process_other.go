//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris

package preview

import (
	"context"
	"errors"
)

var errDynamicUnsupported = errors.New("dynamic previews are not supported on this platform")

func dynamicSupported() bool { return false }

func validateLoopbackListener(context.Context, int) error { return errDynamicUnsupported }
