import test from "node:test";
import assert from "node:assert/strict";
import { resolveComposerActivityStatus } from "./agent-workspace-helpers.mjs";

function translate(key) {
  return {
    "chat.activity.thinking": "思考中",
    "chat.activity.generating": "正在生成",
    "chat.activity.searching": "正在搜索",
    "chat.activity.reading": "正在读取",
    "chat.activity.editing": "正在编辑",
    "chat.activity.writing": "正在写入",
    "chat.activity.runningCommand": "正在执行命令",
    "chat.activity.genericStep": "正在处理",
    "chat.activity.awaitingApproval": "等待批准",
  }[key] || key;
}

test("composer activity prefers pending approval, then tools, then thinking/generating", () => {
  assert.equal(resolveComposerActivityStatus({}, translate), null);

  assert.deepEqual(
    resolveComposerActivityStatus({ agent: { status: "running" } }, translate),
    { kind: "thinking", text: "思考中" },
  );

  assert.deepEqual(
    resolveComposerActivityStatus({ liveAssistantActive: true, liveAssistantText: "" }, translate),
    { kind: "thinking", text: "思考中" },
  );

  assert.deepEqual(
    resolveComposerActivityStatus({ liveAssistantActive: true, liveAssistantText: "hello" }, translate),
    { kind: "generating", text: "正在生成" },
  );

  assert.deepEqual(
    resolveComposerActivityStatus({
      liveAssistantActive: true,
      liveAssistantText: "hello",
      liveToolOutputs: {
        "tool-1": {
          toolUseId: "tool-1",
          toolName: "Read",
          status: "running",
          createdAt: "2026-07-21T00:00:01Z",
          inputJson: { file_path: "/work/project/main.go" },
        },
      },
    }, translate),
    { kind: "tool", text: "正在读取 main.go" },
  );

  assert.deepEqual(
    resolveComposerActivityStatus({
      liveToolOutputs: {
        "tool-1": { toolUseId: "tool-1", toolName: "Read", status: "running", inputJson: { file_path: "a.go" } },
      },
      pendingToolApprovals: {
        "tool-2": { toolUseId: "tool-2", toolName: "Bash" },
      },
    }, translate),
    { kind: "approval", text: "等待批准 · Bash" },
  );
});
