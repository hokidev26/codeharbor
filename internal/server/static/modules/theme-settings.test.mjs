import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createThemeSettingsController } from "./theme-settings.mjs";

function managerSnapshot() {
  return {
    status: "ready",
    error: "",
    missingThemeID: "",
    importing: false,
    deletingThemeID: "",
    themes: [
      {
        id: "argentina-spain-final",
        name: "Argentina × Spain Final",
        version: "1.0.0",
        description: "Original bundled theme",
        author: "Autoto",
        colorScheme: "dark",
        source: "bundled",
        revision: "one",
        stylesheetUrl: "/themes/argentina-spain-final/one/theme.css",
        previewUrl: "/themes/argentina-spain-final/one/preview.png",
        deletable: false,
      },
      {
        id: "local-glass",
        name: "Local Glass",
        version: "0.1.0",
        description: "Imported theme",
        author: "User",
        colorScheme: "light",
        source: "local",
        revision: "two",
        stylesheetUrl: "/themes/local-glass/two/theme.css",
        previewUrl: "",
        deletable: true,
      },
    ],
  };
}

test("theme settings render bundled and local cards with management controls", () => {
  const snapshot = managerSnapshot();
  const controller = createThemeSettingsController({
    themeManager: { snapshot: () => snapshot },
    currentAppearancePreferences: () => ({
      themeRef: { kind: "package", id: "argentina-spain-final", revision: "one", colorScheme: "dark" },
    }),
  });

  const markup = controller.renderThemeLibrarySection();
  assert.match(markup, /id="importThemeBtn"/);
  assert.match(markup, /id="restoreDefaultThemeBtn"/);
  assert.match(markup, /data-theme-package="argentina-spain-final"/);
  assert.match(markup, /data-theme-package="local-glass"/);
  assert.match(markup, /theme-package-card active/);
  assert.match(markup, /data-theme-delete="local-glass"/);
  assert.doesNotMatch(markup, /data-theme-delete="argentina-spain-final"/);
});

test("theme runtime keeps artwork on explicit home state only", async () => {
  const styles = await readFile(new URL("../theme-runtime.css", import.meta.url), "utf8");
  assert.match(styles, /data-autoto-theme/);
  assert.match(styles, /data-theme-page="home-empty"/);
  assert.doesNotMatch(styles, /\.messages\.empty\s*\{[^}]*background-image/s);
  assert.match(styles, /prefers-reduced-transparency/);
  assert.match(styles, /forced-colors: active/);
});
