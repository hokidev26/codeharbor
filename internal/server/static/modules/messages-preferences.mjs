const preferencesMessages = Object.freeze({
  "zh-CN": {
    preferences: {
      backupLabels: {
        profile: "个人资料",
        search: "网络搜索",
        imGateway: "IM 网关",
        skills: "技能工作台",
        notifications: "通知",
        appearance: "外观",
        terminal: "终端",
        regional: "区域格式",
        chatDrafts: "聊天草稿",
        promptHistory: "提示词历史",
        recentDirectories: "最近目录",
        recentConversations: "最近会话",
        preferredModel: "首选模型",
        relayProtocol: "中转协议",
        primaryMode: "主工作台视图",
      },
      settings: {
        profileSaved: "个人资料已保存。",
        localWorkspace: "本地工作台",
        localBackend: "本地",
        updateVersion: "更新: v{version} → …",
        gitIdentityMissing: "# 尚未填写 Git 姓名或邮箱",
        searchSaved: "网络搜索策略已保存。",
        customEndpoint: "自定义端点",
        noSelection: "未选择",
        skillsSaved: "技能工作台已保存。",
        imGatewaySaved: "IM 网关策略已保存。",
        genericWebhook: "通用 Webhook",
        lark: "飞书/Lark",
        wecom: "企业微信",
        customGateway: "自定义网关",
        notificationSaved: "通知偏好已保存。",
        appearanceSaved: "外观偏好已保存。",
      },
      backup: {
        invalidJSON: "{label} 不是有效 JSON",
        invalidFormat: "备份 JSON 格式无效",
        unsupportedFormat: "不支持的本地偏好备份格式",
        preferencesMissing: "备份中未找到 preferences 配置",
        noImportablePreferences: "备份中没有可导入的 Autoto 本地偏好",
        storageWriteFailed: "浏览器无法写入本地偏好，可能是隐私模式或存储空间不足",
      },
      formatters: {
        emptyTimestamp: "暂无",
        invalidTimestamp: "无效日期",
      },
      mcp: {
        invalidEnvironmentJSON: "env JSON 格式无效，请填写对象，例如 {\"TOKEN\":\"...\"}",
        environmentMustBeObject: "env JSON 必须是对象",
        commandRequired: "请填写后端 MCP command",
      },
    },
  },
  "zh-TW": {
    preferences: {
      backupLabels: {
        profile: "個人資料",
        search: "網路搜尋",
        imGateway: "IM 閘道",
        skills: "技能工作台",
        notifications: "通知",
        appearance: "外觀",
        terminal: "終端機",
        regional: "區域格式",
        chatDrafts: "聊天草稿",
        promptHistory: "提示詞歷史",
        recentDirectories: "最近目錄",
        recentConversations: "最近對話",
        preferredModel: "偏好模型",
        relayProtocol: "中轉協定",
        primaryMode: "主要工作台檢視",
      },
      settings: {
        profileSaved: "個人資料偏好已儲存。",
        localWorkspace: "本機工作台",
        localBackend: "本機",
        updateVersion: "更新：v{version} → …",
        gitIdentityMissing: "# 尚未填寫 Git 姓名或電子郵件",
        searchSaved: "網路搜尋策略已儲存。",
        customEndpoint: "自訂端點",
        noSelection: "尚未選擇",
        skillsSaved: "技能工作台已儲存。",
        imGatewaySaved: "IM 閘道策略已儲存。",
        genericWebhook: "通用 Webhook",
        lark: "飛書／Lark",
        wecom: "企業微信",
        customGateway: "自訂閘道",
        notificationSaved: "通知偏好已儲存。",
        appearanceSaved: "外觀偏好已儲存。",
      },
      backup: {
        invalidJSON: "{label} 不是有效 JSON",
        invalidFormat: "備份 JSON 格式無效",
        unsupportedFormat: "不支援的本機偏好備份格式",
        preferencesMissing: "備份中找不到 preferences 設定",
        noImportablePreferences: "備份中沒有可匯入的 Autoto 本機偏好",
        storageWriteFailed: "瀏覽器無法寫入本機偏好，可能是隱私模式或儲存空間不足",
      },
      formatters: {
        emptyTimestamp: "暫無",
        invalidTimestamp: "無效日期",
      },
      mcp: {
        invalidEnvironmentJSON: "env JSON 格式無效，請填寫物件，例如 {\"TOKEN\":\"...\"}",
        environmentMustBeObject: "env JSON 必須是物件",
        commandRequired: "請填寫後端 MCP command",
      },
    },
  },
  en: {
    preferences: {
      backupLabels: {
        profile: "Profile",
        search: "Web search",
        imGateway: "IM gateway",
        skills: "Skills workspace",
        notifications: "Notifications",
        appearance: "Appearance",
        terminal: "Terminal",
        regional: "Regional format",
        chatDrafts: "Chat drafts",
        promptHistory: "Prompt history",
        recentDirectories: "Recent folders",
        recentConversations: "Recent conversations",
        preferredModel: "Preferred model",
        relayProtocol: "Relay protocol",
        primaryMode: "Primary workbench view",
      },
      settings: {
        profileSaved: "Profile preferences saved.",
        localWorkspace: "Local workspace",
        localBackend: "Local",
        updateVersion: "Update: v{version} → …",
        gitIdentityMissing: "# Git name or email has not been entered",
        searchSaved: "Web search strategy saved.",
        customEndpoint: "Custom endpoint",
        noSelection: "No selection",
        skillsSaved: "Skills workspace saved.",
        imGatewaySaved: "IM gateway strategy saved.",
        genericWebhook: "Generic webhook",
        lark: "Feishu / Lark",
        wecom: "WeCom",
        customGateway: "Custom gateway",
        notificationSaved: "Notification preferences saved.",
        appearanceSaved: "Appearance preferences saved.",
      },
      backup: {
        invalidJSON: "{label} is not valid JSON",
        invalidFormat: "Backup JSON is invalid",
        unsupportedFormat: "Unsupported local-preferences backup format",
        preferencesMissing: "The backup does not contain preferences",
        noImportablePreferences: "The backup has no importable Autoto local preferences",
        storageWriteFailed: "The browser could not write local preferences; private browsing or insufficient storage may be the cause",
      },
      formatters: {
        emptyTimestamp: "N/A",
        invalidTimestamp: "Invalid date",
      },
      mcp: {
        invalidEnvironmentJSON: "Environment JSON is invalid. Enter an object, for example {\"TOKEN\":\"...\"}",
        environmentMustBeObject: "Environment JSON must be an object",
        commandRequired: "Enter a backend MCP command",
      },
    },
  },
});

function resolvePreferencesLocale(locale) {
  const normalized = String(locale || "zh-CN").trim().toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hant" || normalized.startsWith("zh-hant-") || normalized === "zh-hk" || normalized === "zh-mo") return "zh-TW";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return "zh-CN";
}

function lookupMessage(catalog, key) {
  return String(key || "").split(".").reduce((value, part) => (
    value && typeof value === "object" ? value[part] : undefined
  ), catalog);
}

function interpolateMessage(message, params = {}) {
  return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : match
  ));
}

export function preferencesMessage(key, params = {}, locale = "zh-CN") {
  const message = lookupMessage(preferencesMessages[resolvePreferencesLocale(locale)], `preferences.${key}`)
    ?? lookupMessage(preferencesMessages["zh-CN"], `preferences.${key}`);
  return message === undefined ? key : interpolateMessage(message, params);
}

export function preferenceMessageKeys(catalog) {
  const keys = [];
  function visit(value, prefix = "") {
    Object.entries(value || {}).forEach(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) visit(child, path);
      else keys.push(path);
    });
  }
  visit(catalog?.preferences);
  return keys.sort();
}

export default preferencesMessages;
