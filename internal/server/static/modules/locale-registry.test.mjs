import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import {
  clearIntlFormatterCache,
  defaultRegionalPreferences,
  getDateTimeFormatter,
  getNumberFormatter,
  intlFormatterCacheSize,
  normalizeLocalePreference,
  normalizeRegionalPreferences,
  normalizeTimeZonePreference,
  resolveLocale,
  setRegionalPreferences,
} from "./locale-registry.mjs";

const modulesURL = new URL("./", import.meta.url);

test("regional preferences normalize supported locales, legacy fields, and IANA zones", () => {
  assert.deepEqual(defaultRegionalPreferences, { locale: "auto", timezone: "auto" });
  assert.equal(normalizeLocalePreference("zh-cn"), "zh-CN");
  assert.equal(normalizeLocalePreference("zh-TW"), "zh-TW");
  assert.equal(normalizeLocalePreference("zh-Hant-HK"), "zh-TW");
  assert.equal(normalizeLocalePreference("zh-HK"), "zh-TW");
  assert.equal(normalizeLocalePreference("en"), "en-US");
  assert.equal(normalizeLocalePreference("fr-FR"), "auto");
  assert.equal(resolveLocale("zh-Hant"), "zh-TW");
  assert.equal(resolveLocale("en"), "en-US");
  assert.equal(normalizeTimeZonePreference("UTC"), "UTC");
  assert.equal(normalizeTimeZonePreference("Asia/Shanghai"), "Asia/Shanghai");
  assert.equal(normalizeTimeZonePreference("Mars/Olympus"), "auto");
  assert.deepEqual(normalizeRegionalPreferences({ language: "en", timeZone: "UTC" }), {
    locale: "en-US",
    timezone: "UTC",
  });
  assert.deepEqual(normalizeRegionalPreferences({}), { locale: "auto", timezone: "auto" });
});

test("Intl number and timestamp formatters are cached by resolved regional options", () => {
  clearIntlFormatterCache();
  const firstNumber = getNumberFormatter({ maximumFractionDigits: 1 }, { locale: "en-US" });
  const secondNumber = getNumberFormatter({ maximumFractionDigits: 1 }, { locale: "en-US" });
  assert.strictEqual(firstNumber, secondNumber);
  assert.equal(intlFormatterCacheSize(), 1);

  const firstDate = getDateTimeFormatter({ year: "numeric" }, { locale: "zh-CN", timezone: "UTC" });
  const secondDate = getDateTimeFormatter({ year: "numeric" }, { locale: "zh-CN", timezone: "UTC" });
  assert.strictEqual(firstDate, secondDate);
  assert.equal(intlFormatterCacheSize(), 2);
  setRegionalPreferences(defaultRegionalPreferences);
});

test("business modules do not bypass shared regional formatters", async () => {
  const names = (await readdir(modulesURL, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .filter((name) => !["formatters.mjs", "locale-registry.mjs"].includes(name));
  const violations = [];
  await Promise.all(names.map(async (name) => {
    const source = await readFile(new URL(name, modulesURL), "utf8");
    if (/\.toLocale(?:String|DateString|TimeString)\s*\(/.test(source)) violations.push(`${name}: direct toLocale*`);
    if (/(?:function|const|let|var)\s+formatBytes\b/.test(source)) violations.push(`${name}: local formatBytes`);
  }));
  assert.deepEqual(violations.sort(), []);
});
