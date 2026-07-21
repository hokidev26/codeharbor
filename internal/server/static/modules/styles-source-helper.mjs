import { readFile } from "node:fs/promises";

// Test helper. The production stylesheet was split into cascade-ordered
// modules under styles/ that styles.css re-assembles via @import in order.
// Reading styles.css alone now yields only @import lines, so tests that assert
// on the full CSS text resolve those imports here and concatenate them in
// order — byte-for-byte equivalent to the pre-split styles.css.
export async function readStylesSource(stylesUrl) {
  const entry = await readFile(stylesUrl, "utf8");
  const imports = [...entry.matchAll(/@import\s+url\("([^"]+)"\)/g)].map((m) => m[1]);
  if (imports.length === 0) return entry;
  const parts = await Promise.all(imports.map((rel) => readFile(new URL(rel, stylesUrl), "utf8")));
  return parts.join("");
}
