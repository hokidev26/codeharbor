package main

import (
	"os"

	"autoto/internal/app"
)

func main() {
	os.Exit(app.Run(app.Options{LegacyCommand: true}))
}
