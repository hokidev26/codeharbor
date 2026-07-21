import test from "node:test";
import assert from "node:assert/strict";
import { encodeQRModules, qrToSvg } from "./qrcode.mjs";

test("encodeQRModules builds a square matrix for a tunnel URL", () => {
  const modules = encodeQRModules("https://bright-sun.trycloudflare.com");
  assert.ok(Array.isArray(modules));
  assert.ok(modules.length >= 21);
  assert.equal(modules.length, modules[0].length);
  // Finder pattern top-left dark corner
  assert.equal(modules[0][0], true);
});

test("qrToSvg returns embeddable SVG markup", () => {
  const svg = qrToSvg("https://example.trycloudflare.com", { size: 160 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox=/);
  assert.match(svg, /<path /);
  assert.match(svg, /role="img"/);
});

test("encodeQRModules rejects empty payload", () => {
  assert.throws(() => encodeQRModules(""), /empty/);
});
