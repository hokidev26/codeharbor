//go:build desktop

package desktop

import _ "embed"

//go:embed assets/app-icon-256.png
var appIconPNG []byte

//go:embed assets/tray-icon-32.png
var trayIconPNG []byte

//go:embed assets/tray-icon-16.png
var trayIconSmallPNG []byte
