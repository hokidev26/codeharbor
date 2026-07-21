// What the sidebar's single create button makes depends on the surface the user
// is looking at. Schedules mode always creates a schedule; otherwise the
// navigation mode decides between a standalone conversation and picking a
// folder for a project. Kept pure so the mapping, and the label that has to
// agree with it, can be checked without a DOM.

export function navigationCreateTarget({ activeWorkbench = "", navigationMode = "" } = {}) {
  if (activeWorkbench === "schedules") return "schedule";
  return navigationMode === "conversations" ? "conversation" : "project";
}

const navigationCreateLabelKeys = {
  schedule: "shell.newSchedule",
  project: "shell.chooseFolder",
  conversation: "shell.newConversation",
};

export function navigationCreateLabelKey(target) {
  return navigationCreateLabelKeys[target] || navigationCreateLabelKeys.conversation;
}
