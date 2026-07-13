export const settingsSections = [
  {
    title: "个人设置",
    items: [
      { key: "profile", icon: "♙", label: "个人资料", subtitle: "管理当前用户的显示信息、头像与身份。" },
      { key: "models", icon: "⚙", label: "模型", subtitle: "配置默认模型、模型列表与推理偏好。" },
      { key: "agents", icon: "♧", label: "AI 代理", subtitle: "设置代理默认行为、权限模式与运行策略。" },
      { key: "skills", icon: "✦", label: "技能", subtitle: "管理技能、命令和 MCP 工具，增强你的 AI 工作流。" },
      { key: "notifications", icon: "♢", label: "通知", subtitle: "管理任务完成、错误与后台运行提醒。" },
      { key: "appearance", icon: "◉", label: "外观与界面", subtitle: "调整主题、布局密度和界面显示。" },
      { key: "im-gateway", icon: "◌", label: "IM 网关", subtitle: "连接 IM、Webhook 与外部消息入口。" },
    ],
  },
  {
    title: "实例管理",
    items: [
      { key: "providers", icon: "☁", label: "提供商", subtitle: "管理 OpenAI、Anthropic 与 OpenAI-compatible 提供商。" },
      { key: "network-search", icon: "⌕", label: "网络搜索", subtitle: "配置搜索提供商、权限与结果策略。" },
      { key: "agent-admin", icon: "⬡", label: "代理管理", subtitle: "查看、切换和治理本地 Agent Server 后端。" },
      { key: "worklines-containers", icon: "◇", label: "工作线与容器", subtitle: "管理工作线、容器和隔离策略。" },
      { key: "servers-system", icon: "▤", label: "服务器与系统", subtitle: "查看服务状态、端口、版本与系统资源。" },
      { key: "users", icon: "♟", label: "用户管理", subtitle: "管理本地用户、角色和访问策略。" },
      { key: "terminals", icon: "▻", label: "终端管理", subtitle: "管理 PTY 终端、会话和默认 shell。" },
      { key: "storage", icon: "▭", label: "储存空间", subtitle: "查看数据库、项目目录和缓存占用。" },
      { key: "runtime", icon: "▷", label: "运行资源", subtitle: "管理后台任务、运行时和资源限制。" },
      { key: "usage", icon: "▧", label: "使用历史", subtitle: "查看消息、工具调用和模型请求历史。" },
      { key: "about", icon: "ⓘ", label: "关于", subtitle: "查看版本、许可证和第三方依赖。" },
    ],
  },
];

export const settingsItems = settingsSections.flatMap((section) => section.items);

export const skillTabs = [
  { key: "commands", label: "命令", description: "服务端斜杠命令与 SKILL.md 模板，展开为聊天提示词；输入 /命令名 即可使用。", empty: "暂无命令，添加一个以开始使用。", action: "添加命令" },
  { key: "optional-tools", label: "可选工具", description: "控制代理可按需启用的辅助工具集合。", empty: "暂无可选工具配置。", action: "添加工具" },
  { key: "tool-permissions", label: "工具权限", description: "定义 Read、Write、Edit、Bash 等工具在不同权限模式下的行为。", empty: "尚未配置自定义工具权限。", action: "添加规则" },
  { key: "global-skills", label: "全局技能", description: "对所有项目生效的技能包和工作流。", empty: "暂无全局技能。", action: "添加技能" },
  { key: "project-skills", label: "项目技能", description: "只在当前项目或目录中生效的技能。", empty: "暂无项目技能。", action: "添加项目技能" },
  { key: "subagents", label: "自定义子代理", description: "定义专用子代理类型、提示词和工具权限。", empty: "暂无自定义子代理。", action: "添加子代理" },
  { key: "global-prompts", label: "全局提示词", description: "对所有会话追加的用户级提示词。", empty: "暂无全局提示词。", action: "添加提示词" },
  { key: "system-prompts", label: "系统提示词", description: "管理系统级提示词模板与安全边界。", empty: "暂无自定义系统提示词。", action: "添加系统提示词" },
  { key: "mcp-tools", label: "MCP 工具", description: "连接和管理 MCP server 暴露的工具。", empty: "暂无 MCP 工具。", action: "添加 MCP" },
  { key: "hooks", label: "钩子", description: "配置运行前后、工具调用前后等自动化钩子。", empty: "暂无钩子。", action: "添加钩子" },
];
