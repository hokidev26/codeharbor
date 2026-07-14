import { currentUILocale } from "./i18n.mjs";

export const gitExtraMessages = Object.freeze({
  "zh-CN": {
    gitExtra: {
      selectAgent: "请先选择 Agent",
      statusUnavailable: "Git 状态不可用：{message}",
      changesCount: "查看 Git 变更（{count} 个文件）",
      clean: "查看 Git 变更（工作区干净）",
      refreshed: "Git 状态已刷新。",
      commitMessageRequired: "请输入 commit message。",
      filesRequired: "请先选择要提交的文件。",
      commitCreated: "已创建提交{hash}。",
      pathHint: "查看并提交当前 Agent 工作目录的 Git 变更。",
      fallbackBranch: "Git",
      filesChanged: "{count} 个文件有变更",
      workspaceClean: "工作区干净",
      notLoaded: "尚未加载",
      aheadBehind: "· ahead {ahead} / behind {behind}",
      diffScope: "Diff 范围",
      all: "全部",
      unstaged: "未暂存",
      staged: "已暂存",
      refresh: "刷新",
      changedFiles: "变更文件",
      diff: "Diff",
      diffTruncated: "Diff 输出已截断，只显示前半部分。",
      recentCommits: "最近提交",
      commitSelected: "提交所选变更",
      commitSafety: "只会 add/commit 下方勾选的路径；不会 push、amend、reset 或 clean。",
      selectedCount: "{count} 个已选择",
      commitPlaceholder: "输入 commit message",
      selectAll: "全选变更",
      clearSelection: "清空选择",
      committing: "提交中…",
      commitFiles: "提交所选文件",
      noChanges: "暂无工作区变更。",
      selectFile: "选择 {path} 提交",
      noDiff: "暂无 diff。未跟踪文件当前只在状态列表中展示。",
      noHistory: "暂无提交记录。",
    },
  },
  "zh-TW": {
    gitExtra: {
      selectAgent: "請先選擇 Agent",
      statusUnavailable: "Git 狀態不可用：{message}",
      changesCount: "查看 Git 變更（{count} 個檔案）",
      clean: "查看 Git 變更（工作區乾淨）",
      refreshed: "Git 狀態已重新整理。",
      commitMessageRequired: "請輸入 commit message。",
      filesRequired: "請先選擇要提交的檔案。",
      commitCreated: "已建立提交{hash}。",
      pathHint: "查看並提交目前 Agent 工作目錄的 Git 變更。",
      fallbackBranch: "Git",
      filesChanged: "{count} 個檔案有變更",
      workspaceClean: "工作區乾淨",
      notLoaded: "尚未載入",
      aheadBehind: "· ahead {ahead} / behind {behind}",
      diffScope: "Diff 範圍",
      all: "全部",
      unstaged: "未暫存",
      staged: "已暫存",
      refresh: "重新整理",
      changedFiles: "變更檔案",
      diff: "Diff",
      diffTruncated: "Diff 輸出已截斷，只顯示前半部。",
      recentCommits: "最近提交",
      commitSelected: "提交所選變更",
      commitSafety: "只會 add/commit 下方勾選的路徑；不會 push、amend、reset 或 clean。",
      selectedCount: "{count} 個已選擇",
      commitPlaceholder: "輸入 commit message",
      selectAll: "全選變更",
      clearSelection: "清空選擇",
      committing: "提交中…",
      commitFiles: "提交所選檔案",
      noChanges: "暫無工作區變更。",
      selectFile: "選擇 {path} 提交",
      noDiff: "暫無 diff。未追蹤檔案目前只在狀態清單中顯示。",
      noHistory: "暫無提交記錄。",
    },
  },
  en: {
    gitExtra: {
      selectAgent: "Select an agent first",
      statusUnavailable: "Git status unavailable: {message}",
      changesCount: "View Git changes ({count} files)",
      clean: "View Git changes (workspace clean)",
      refreshed: "Git status refreshed.",
      commitMessageRequired: "Enter a commit message.",
      filesRequired: "Select files to commit first.",
      commitCreated: "Created commit{hash}.",
      pathHint: "View and commit Git changes in the current agent workspace.",
      fallbackBranch: "Git",
      filesChanged: "{count} files changed",
      workspaceClean: "Workspace clean",
      notLoaded: "Not loaded",
      aheadBehind: "· ahead {ahead} / behind {behind}",
      diffScope: "Diff scope",
      all: "All",
      unstaged: "Unstaged",
      staged: "Staged",
      refresh: "Refresh",
      changedFiles: "Changed files",
      diff: "Diff",
      diffTruncated: "Diff output was truncated; only the first part is shown.",
      recentCommits: "Recent commits",
      commitSelected: "Commit selected changes",
      commitSafety: "Only the checked paths below are added and committed; nothing is pushed, amended, reset, or cleaned.",
      selectedCount: "{count} selected",
      commitPlaceholder: "Enter a commit message",
      selectAll: "Select all changes",
      clearSelection: "Clear selection",
      committing: "Committing…",
      commitFiles: "Commit selected files",
      noChanges: "No workspace changes.",
      selectFile: "Select {path} to commit",
      noDiff: "No diff. Untracked files are currently only shown in the status list.",
      noHistory: "No commit history.",
    },
  },
});

function lookup(catalog, key) {
  return String(key || "").split(".").reduce((value, part) => value && typeof value === "object" ? value[part] : undefined, catalog);
}

function interpolate(message, params = {}) {
  return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : match
  ));
}

export function gitExtraT(key, params = {}, locale = currentUILocale()) {
  const message = lookup(gitExtraMessages[locale], `gitExtra.${key}`) ?? lookup(gitExtraMessages["zh-CN"], `gitExtra.${key}`);
  return message === undefined ? key : interpolate(message, params);
}

export default gitExtraMessages;
