import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { AUTOTO_LOCAL_TOKEN: "", CODEHARBOR_LOCAL_TOKEN: "" };
globalThis.location = { origin: "http://localhost", protocol: "http:", host: "localhost" };

const {
  clipboardFiles,
  interfaceLocale,
  maxChatDraftCharacters,
  mentionTrigger,
  normalizeChatDrafts,
  truncateChatDraft,
  unicodeCharacters,
} = await import("./chat-composer.mjs");

test("chat drafts truncate on Unicode code point boundaries", () => {
  const value = `${"a".repeat(maxChatDraftCharacters - 1)}😀尾`;
  const result = truncateChatDraft(value);
  assert.equal(result.length, maxChatDraftCharacters + 1);
  assert.equal(unicodeCharacters(result.text).length, maxChatDraftCharacters);
  assert.equal(result.text.endsWith("😀"), true);
  assert.equal(result.truncated, true);
  assert.equal(normalizeChatDrafts({ agent: value }).agent, result.text);
});

test("clipboardFiles keeps file items without consuming text", () => {
  const file = { name: "screen.png", size: 12 };
  const event = {
    clipboardData: {
      files: [],
      items: [
        { kind: "string" },
        { kind: "file", getAsFile: () => file },
      ],
    },
  };
  assert.deepEqual(clipboardFiles(event), [file]);
});

test("interfaceLocale prefers the page language", () => {
  assert.equal(interfaceLocale({ documentElement: { lang: "en-US" } }, { language: "fr-FR" }), "en-US");
  assert.equal(interfaceLocale({ documentElement: { lang: "" } }, { language: "fr-FR" }), "fr-FR");
});

test("mentionTrigger supports Chinese and Unicode handles", () => {
  assert.deepEqual(mentionTrigger("请看 @张三", 6), { query: "张三", start: 3, end: 6 });
  assert.equal(mentionTrigger("mail@example.com", 16), null);
});
