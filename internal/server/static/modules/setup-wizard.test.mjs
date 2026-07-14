import test from "node:test";
import assert from "node:assert/strict";

import { discoverSetupModels } from "./setup-wizard.mjs";

test("setup wizard discovers arbitrary providers with usable models", () => {
  const models = discoverSetupModels({
    providers: [
      { name: "custom-gateway", type: "gemini-interactions", configured: true, models: ["gemini-test"], discovered: true },
      { name: "broken", type: "openai-compatible", configured: true, models: ["fallback"], error: "offline", modelsSource: "fallback" },
    ],
  });
  assert.deepEqual(models.map((item) => item.value), ["custom-gateway:gemini-test"]);
});

test("setup wizard remains compatible with the existing catalog shape", () => {
  const models = discoverSetupModels({ providers: [{ name: "relay", type: "openai-compatible", configured: true, models: ["model-a"] }] });
  assert.equal(models[0].value, "relay:model-a");
});
