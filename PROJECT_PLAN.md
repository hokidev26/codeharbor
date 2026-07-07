# CodeHarbor Go MVP 项目规划

## 1. 项目目标

本项目目标是用 Go 实现 CodeHarbor：一个本地 AI 编程 Agent 后端。

核心目标不是一次性堆满所有功能，而是先做出一个可运行、可扩展、可逐步替换/增强的 MVP：

- 本地 HTTP 服务
- SQLite 持久化
- Project / Chapter / Narrator 数据模型
- Agent 会话与消息记录
- Provider 抽象
- Tool 抽象与基础工具执行
- WebSocket 事件推送
- 基础文件系统 API
- 基础开源协议依赖清单
- 简单内嵌 Web UI
- 公开仓库入口文档、MIT License、CI 与安全说明

长期目标是逐步扩展到：

- 多模型 Provider
- MCP
- 子代理
- Git worktree / fork / merge / review
- 终端 PTY
- 浏览器工具
- 权限审批 UI
- 前端 Web UI
- 存储清理与运行时管理

---

## 2. 当前 MVP 范围

当前 MVP 的重点是建立后端核心闭环：

```txt
用户输入
  -> narrator message 入库
  -> agent loop
  -> provider 生成回复
  -> assistant message 入库
  -> WebSocket 推送事件
```

并补充手动工具执行闭环：

```txt
POST /api/narrators/{id}/tool-calls
  -> permission 判断
  -> 执行工具
  -> narrator_tool_calls 入库
  -> 返回工具结果
```

---

## 3. 当前已完成内容

### 3.1 Go 项目骨架

目录：

```txt
codeharbor/
  go.mod
  go.sum
  .gitignore
  cmd/codeharbor/main.go
  internal/config
  internal/db
  internal/server
  internal/agent
  internal/providers
  internal/tools
```

启动方式：

```bash
go run ./cmd/codeharbor
```

默认监听：

```txt
http://localhost:7788
```

默认配置路径：

```txt
~/.codeharbor/config.json
```

默认数据库路径：

```txt
~/.codeharbor/codeharbor.db
```

默认项目目录：

```txt
~/projects
```

---

### 3.2 配置模块

文件：

```txt
internal/config/defaults.go
```

当前默认配置包含：

- server host / port
- home dir
- database path
- default project dir
- agent 默认模型
- agent 默认权限模式
- 多 provider 实例配置（OpenAI 官方 / Anthropic 官方 / OpenAI-compatible / CLIProxyAPI 本地预置）

当前默认：

```txt
server.host = localhost
server.port = 7788
agent.defaultPermissionMode = acceptEdits
agent.defaultModel = openai:gpt-4.1-mini
```

Agent 模型支持环境变量：

```txt
CODEHARBOR_DEFAULT_MODEL
CODEHARBOR_SUMMARY_MODEL
```

Provider 支持环境变量：

```txt
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
OPENAI_COMPATIBLE_BASE_URL
OPENAI_COMPATIBLE_API_KEY
OPENAI_COMPATIBLE_MODEL
CLIPROXYAPI_BASE_URL
CLIPROXYAPI_API_KEY
CLIPROXYAPI_MODEL
CLIPROXYAPI_MANAGEMENT_KEY
CLIPROXYAPI_BIN
CLIPROXYAPI_CONFIG
```

首次生成默认 `config.json` 时，运行时仍会读取环境变量中的 API key，但写入磁盘的默认配置会清空 provider/backend API key，避免把 shell 环境里的 secret 持久化。

---

### 3.3 SQLite 数据库

文件：

```txt
internal/db/schema.go
internal/db/db.go
```

当前已建表：

```txt
users
projects
chapters
narrators
narrator_messages
narrator_tool_calls
api_requests
agent_backends
background_tasks
```

这些表的命名与字段风格尽量贴近 AI 编程工作台数据模型，方便后续迁移或扩展。

核心关系：

```txt
projects
  -> chapters
      -> narrators
          -> narrator_messages
          -> narrator_tool_calls
```

---

### 3.4 HTTP API

当前已实现：

```txt
GET  /api/health
GET  /api/auth/status
GET  /api/settings
GET  /api/models
GET  /api/licenses
GET  /api/runtime/summary
GET  /api/storage/summary
GET  /api/usage/summary

PUT  /api/providers/{name}/config

GET  /api/providers/cliproxyapi/auth-files
POST /api/providers/cliproxyapi/auth-files/import

GET    /api/backends
POST   /api/backends
GET    /api/backends/{id}
PATCH  /api/backends/{id}
DELETE /api/backends/{id}
POST   /api/backends/{id}/activate
GET    /api/backends/{id}/health

GET  /api/projects
POST /api/projects
GET  /api/projects/{id}

GET  /api/chapters/{id}

GET   /api/narrators/{id}
PATCH /api/narrators/{id}/cwd
PATCH /api/narrators/{id}/model
PATCH /api/narrators/{id}/permission-mode
GET   /api/narrators/{id}/messages
POST  /api/narrators/{id}/messages
GET   /api/narrators/{id}/tools
POST  /api/narrators/{id}/tool-calls
GET   /api/narrators/{id}/tool-calls/{toolUseId}

GET  /api/fs/browse?path=...
GET  /api/fs/directories?path=...
GET  /api/fs/preview?path=...
POST /api/fs/mkdir

GET  /ws/narrator?id={narratorId}
GET  /ws/terminal?narratorId={narratorId}
```

---

### 3.5 Project 创建行为

`POST /api/projects` 请求示例：

```json
{
  "name": "Demo Project",
  "description": "optional",
  "gitPath": "optional",
  "model": "optional provider:model override"
}
```

如果未传 `gitPath`，系统会自动创建：

```txt
~/projects/<project-name-slug>
```

例如：

```txt
~/projects/demo-project
```

并自动创建：

- project
- root chapter
- primary narrator

---

### 3.6 Agent loop

文件：

```txt
internal/agent/loop.go
internal/agent/hub.go
```

当前能力：

- 接收用户消息
- 写入 `narrator_messages`
- 启动 goroutine 执行 agent loop
- 调用默认 provider
- 写入 assistant message
- 更新 narrator status
- 经 WebSocket 推送事件

当前 WebSocket 事件包括：

```txt
connected
agent.started
agent.text
agent.done
agent.error
message.created
tool.started
tool.finished
```

---

### 3.7 Provider 抽象

文件：

```txt
internal/providers/provider.go
internal/providers/openai_compatible.go
internal/providers/openai_official.go
internal/providers/anthropic_provider.go
```

当前实现：

```txt
openai              -> OpenAI 官方 Go SDK，Responses API
anthropic           -> Anthropic 官方 Go SDK，Messages API
openai-compatible   -> 手写 OpenAI-compatible Chat Completions 兼容层
cliproxyapi         -> 基于 OpenAI-compatible 的本地 CLIProxyAPI 预置
```

模型字符串使用 `provider:model` 前缀路由，例如：

```txt
openai:gpt-4.1-mini
anthropic:claude-sonnet-4-5
openai-compatible:gpt-4.1-mini
cliproxyapi:gpt-5.5
```

如果没有设置对应 API key，provider 会返回配置提示，不会真正请求外部模型；CLIProxyAPI 本地预置例外，它默认允许无客户端 API key 连接 `http://127.0.0.1:8317/v1`，如 CLIProxyAPI 启用了 `api-keys` 再通过 `CLIPROXYAPI_API_KEY` 注入。当前官方 SDK provider 先使用非流式调用打通 MVP；流式输出、tool calling、usage/cost 统计保留为后续增强。

环境变量：

```txt
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
OPENAI_COMPATIBLE_BASE_URL
OPENAI_COMPATIBLE_API_KEY
OPENAI_COMPATIBLE_MODEL
CLIPROXYAPI_BASE_URL
CLIPROXYAPI_API_KEY
CLIPROXYAPI_MODEL
CLIPROXYAPI_MANAGEMENT_KEY
CLIPROXYAPI_BIN
CLIPROXYAPI_CONFIG
```

后续计划支持：

- Codex 凭证导入体验继续完善（账号状态、额度、错误恢复）
- Kiro-like provider
- 本地模型 provider
- 多 provider fallback / load balancing

---

### 3.8 Tool 抽象与核心工具

文件：

```txt
internal/tools
```

当前工具：

```txt
Read
Write
Edit
Bash
Glob
Grep
```

工具接口：

```go
type Tool interface {
    Name() string
    Description() string
    Schema() any
    Risk(input json.RawMessage) Risk
    Execute(ctx context.Context, call Call, env Env) (Result, error)
}
```

当前风险类型：

```txt
read
write
exec
danger
```

当前权限模式：

```txt
readOnly
acceptEdits
default
dontAsk
bypassPermissions
```

初版策略：

- `readOnly`：只允许 read 风险工具
- `acceptEdits/default/dontAsk`：允许 read/write，默认不允许 Bash exec
- `bypassPermissions`：允许大多数工具，但仍阻止 danger
- danger：当前总是拒绝

危险命令初步识别：

```txt
rm
rmdir
shred
```

---

### 3.9 文件系统 API

文件：

```txt
internal/server/fs.go
```

当前 API：

```txt
GET  /api/fs/browse?path=...
GET  /api/fs/directories?path=...
GET  /api/fs/preview?path=...
POST /api/fs/mkdir
```

安全边界：

- 默认限制在 `paths.defaultProjectDir`
- 相对路径基于 default project dir
- 阻止 `..` 逃逸

后续计划：

- 支持 narrator cwd 边界
- 支持项目维度 path scope
- 支持二进制文件识别
- 支持图片/Notebook/PDF 预览

---

### 3.10 Agent Server 后端注册表

文件：

```txt
internal/server/backends.go
internal/db/db.go
internal/db/schema.go
```

当前能力：

- 持久化多个兼容 OpenHands Agent Server 的后端
- 保证同一时间只有一个 active 后端
- 支持本地后端 `X-Session-API-Key` 与云端后端 `Authorization: Bearer ...`
- 健康检查 `/alive`、`/health`、`/ready`、`/server_info`
- UI 中可以添加、检测、切换、删除后端
- 可通过环境变量 seed 初始后端：
  - `CODEHARBOR_AGENT_BACKEND_URL`
  - `OPENHANDS_AGENT_SERVER_URL`
  - `AGENT_SERVER_URL`
  - `CODEHARBOR_AGENT_BACKEND_API_KEY`
  - `OPENHANDS_SESSION_API_KEY`
  - `AGENT_SERVER_API_KEY`

注意：API 返回时只暴露 `apiKeyConfigured`，不会回显后端 API key。

---

### 3.11 内嵌 Web UI

文件：

```txt
internal/server/ui.go
internal/server/static/index.html
internal/server/static/styles.css
internal/server/static/app.js
```

当前 UI 是 **shadcn-inspired**，参考 shadcn/ui 的简洁 card、button、input、badge、border、radius 风格，但没有直接引入 React、Tailwind、Radix 或 shadcn 组件源码。

当前路由：

```txt
GET /
GET /ui/styles.css
GET /ui/app.js
```

当前页面能力：

- 查看健康状态
- 查看项目列表
- 创建项目
- 自动选择 root chapter / primary narrator
- 查看 narrator messages
- 复制任意用户/助手消息原文，或一键复制当前对话 Markdown，便于整理 issue、PR 描述或外部笔记
- 发送消息
- 按当前 narrator 浏览器本地自动保存/恢复聊天输入草稿，切换项目或刷新页面不丢失未发送内容
- 在聊天输入框中通过浏览器本地提示词历史保存最近提示，并在空输入时用 ↑/↓ 快速召回
- 在聊天输入框输入 `/` 调出已启用的本地技能命令模板，并通过键盘或点击插入提示词
- 连接 `/ws/narrator`
- 查看 WebSocket event log
- 连接 `/ws/terminal` 交互式 PTY
- 通过设置 → 终端管理查看 PTY 状态、重连/清空/复制/聚焦终端，并管理输出保留和连接后聚焦偏好
- 更新 narrator cwd / model / permission mode
- 浏览 `/api/fs/browse`
- 预览 `/api/fs/preview`
- 在设置弹窗内搜索/过滤个人设置、实例管理和各产品化设置面板，并支持快捷键聚焦搜索
- 查看 settings 简要统计，并在设置 → 关于中通过 `/api/licenses` 查看第三方依赖许可证清单
- 在设置 → 关于中复制、下载、导入浏览器本地偏好备份，迁移个人资料、技能草案、聊天草稿、提示词历史、搜索/IM/通知/外观/终端/模型和中转协议设置
- 查看 `/api/runtime/summary` 驱动的服务器与系统、运行资源、Go runtime、内存和 Agent 限制概览
- 查看 `/api/storage/summary` 驱动的储存空间、数据库、配置文件和默认项目目录容量统计
- 查看 `/api/usage/summary` 驱动的使用历史、消息/工具/模型请求/后台任务统计
- 查看 `/api/auth/status` 驱动的用户初始化和注册开放状态
- 从 `/api/models` 动态刷新 CLIProxyAPI 凭证账号可用模型

- 设置 → 个人资料页内完成浏览器本地显示名、头像缩写、身份标签、工作台标签和 Git 身份辅助
- 设置 → 网络搜索页内完成浏览器本地搜索提供商、结果数、安全/确认开关、GitHub 优先和域名规则策略
- 设置 → IM 网关页内完成浏览器本地 Webhook/Discord/Slack/Telegram/Lark/企业微信预设、入站确认、签名、脱敏和事件路由策略
- 设置 → 技能页内完成浏览器本地斜杠命令模板、MCP server 草案、工具权限策略和 JSON 导出
- 设置 → 章节与容器页内完成当前项目章节/workline、当前章节 narrator、worktree/branch/容器隔离边界概览和快速切换
- 设置 → AI 代理页内完成默认 Agent 策略概览、当前 narrator 状态、模型/权限/workdir 快速调整和 ID 复制
- 设置 → 用户管理页内完成本地 auth status 只读视图、注册状态、安全边界和后续多用户路线提示
- 设置 → 通知页内完成浏览器本地 toast 类型、显示时长和 UI 终端提示偏好
- 设置 → 外观与界面页内完成浏览器本地主题、布局密度、终端默认展开和 Agent 事件日志显示偏好
- 设置 → 关于页内完成浏览器本地偏好备份、下载、复制和导入恢复，便于跨浏览器或跨机器迁移工作台设置
- 设置 → 模型/提供商页内完成模型刷新、Codex Token/JSON 凭证导入、账号列表刷新、中转站 API Key/Base URL/协议/默认模型保存、模型选择和首选模型保存
- 设置 → 代理管理页内完成 Agent Server 后端列表、健康检测、启用切换、双击确认删除和新增后端

后续如果需要正式使用 shadcn/ui，可升级为：

```txt
web/
  package.json
  vite.config.ts
  src/
  components/ui/*
```

并使用 React + Tailwind + shadcn registry。正式引入前需要重新整理 Node 依赖协议。

---

### 3.12 License API

文件：

```txt
internal/server/licenses.go
```

当前 API：

```txt
GET /api/licenses
```

当前用途：

- 读取 Go build info 中的依赖
- 对已确认模块标注 license
- 未确认模块标为 `unknown`

当前已确认直接依赖：

```txt
github.com/go-chi/chi/v5               MIT
github.com/google/uuid                 BSD-3-Clause
modernc.org/sqlite                     BSD-3-Clause
nhooyr.io/websocket                    ISC
github.com/openai/openai-go/v3         Apache-2.0
github.com/anthropics/anthropic-sdk-go MIT
github.com/creack/pty                  MIT
```

注意：

此接口只是开发期合规辅助，不是法律意见。发布前仍需生成完整 third-party notice。

---

### 3.13 公开仓库基础建设

当前已补齐：

```txt
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md
THIRD_PARTY_NOTICES.md
.github/workflows/ci.yml
```

说明：

- 仓库入口以 `README.md` 为准。
- `PROJECT_PLAN.md` 用于开发规划和实现状态跟踪。
- `THIRD_PARTY_NOTICES.md` 是直接依赖初版说明，不是法律意见；正式发布前仍应生成完整 transitive notice。
- CI 会检查 Go 格式、测试、vet、构建和内嵌 JavaScript 语法。

---

## 4. 当前测试

已有测试：

```txt
internal/config/defaults_test.go
internal/db/db_test.go
internal/server/backends_test.go
internal/tools/tools_test.go
```

覆盖：

- 默认配置与后端环境变量 seed
- 创建 project/chapter/narrator
- agent backend registry 单 active 约束
- OpenHands Agent Server 健康检查
- 工具路径越界检查
- Write 后 Read

当前验证命令：

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
go build ./...
node --check internal/server/static/app.js
```

短启动验证包括：

- `/api/health`
- `/api/licenses`
- `/api/backends`
- `/api/backends/{id}/health`
- `POST /api/projects`
- `POST /api/narrators/{id}/tool-calls`

---

## 5. 短期路线图

### Phase 1：当前 MVP 完善

目标：让后端更适合手工/CLI 调试。

待做：

- [x] `GET /api/projects/{id}/chapters`
- [x] `GET /api/chapters/{id}/narrators`
- [x] `PATCH /api/narrators/{id}/cwd`
- [x] `PATCH /api/narrators/{id}/model`
- [x] `PATCH /api/narrators/{id}/permission-mode`
- [ ] `POST /api/narrators/{id}/interrupt`
- [x] 工具调用 WebSocket 事件
- [ ] provider request/response 记录到 `api_requests`
- [ ] narrator status 更细化：`idle/running/error/interrupted`

---

### Phase 2：工具系统增强

目标：让工具更接近可用编码 Agent。

待做：

- [x] Edit 工具
- [ ] Bash 支持显式审批状态
- [ ] Bash 输出流式事件
- [ ] 工具执行超时配置
- [ ] 工具输出截断策略配置
- [ ] 工具输入 JSON schema 输出
- [ ] 工具权限规则表
- [ ] whitelist/blacklist dirs
- [ ] whitelist/blacklist commands

---

### Phase 3：Provider 增强

目标：支持真实模型流式与 tool calling。

待做：

- [ ] OpenAI-compatible streaming
- [ ] OpenAI 官方 Responses API streaming
- [ ] Anthropic 官方 Messages API streaming
- [ ] tool call parsing
- [ ] tool result 回灌模型
- [x] Anthropic 官方 SDK provider（非流式 MVP）
- [x] OpenAI 官方 Responses API provider（非流式 MVP）
- [x] provider 前缀路由与基础 model list
- [ ] usage/cost 统计
- [ ] retry/backoff
- [ ] first token timeout

---

### Phase 4：Git / Chapter 工作流

目标：实现多分支、多工作线能力。

待做：

- [ ] Git status/diff/log/commit API
- [ ] project git path 检查
- [ ] chapter fork
- [ ] git worktree 创建
- [ ] chapter merge-check
- [ ] merge
- [ ] AI resolve conflict
- [ ] review chapter

---

### Phase 5：MCP / Terminal / Runtime

目标：补齐高级能力。

待做：

- [ ] MCP server registry
- [ ] MCP tool discovery
- [ ] MCP tool execution
- [x] PTY terminal
- [x] `/ws/terminal`
- [ ] background tasks
- [ ] process list
- [ ] runtime cleanup

---

### Phase 6：前端

目标：提供本地 Web UI。

初版 UI 页面：

- [ ] Project list
- [ ] Chapter detail
- [ ] Narrator chat
- [ ] Tool calls panel
- [ ] File browser
- [ ] Settings
- [ ] License report

可选技术：

- React + Vite
- SvelteKit
- HTMX + Go templates

建议先用简单 React/Vite，后端静态托管 `web/dist`。

---

## 6. 开源协议整理计划

### 当前 Go MVP

可以从：

```txt
go.mod
go.sum
Go module cache LICENSE files
runtime/debug BuildInfo
```

生成依赖协议表。

后续可以增加命令：

```txt
codeharbor licenses export
```

生成：

```txt
THIRD_PARTY_NOTICES.md
licenses.json
```

### 上游参考二进制

仅靠二进制字符串不能可靠确定完整依赖协议。

若要整理上游参考实现的协议，需要输入：

```txt
package.json
bun.lockb / bun.lock
pnpm-lock.yaml / package-lock.json / yarn.lock
LICENSE
NOTICE
THIRD_PARTY_NOTICES
licenses 目录
其它子项目的 go.mod / Cargo.lock 等
```

拿到这些文件后，可以整理：

```txt
依赖名
版本
license
是否 copyleft
是否需要 NOTICE
是否需要源代码公开
是否可商用
风险等级
备注
```

---

## 7. 当前已知限制

当前 MVP 仍有这些限制：

- 前端 UI 仍是内嵌 HTML/CSS/JS MVP，不是完整 React/shadcn 实现
- 没有真实权限审批流程
- Agent loop 暂未支持模型 tool calling
- OpenAI / Anthropic / OpenAI-compatible provider 暂未流式输出
- Bash 工具默认在 `acceptEdits` 下不可执行
- `/api/fs` 当前以 default project dir 为边界，尚未按 narrator cwd 动态限制
- license API 只确认了部分依赖协议
- 没有 Git worktree/fork/merge
- 没有 MCP

---

## 8. 下一步建议

建议下一轮优先做：

1. OpenAI Responses API streaming + tool calling
2. Anthropic Messages API streaming + tool calling
3. tool result 回灌模型，形成自动工具循环
4. `api_requests` 记录与 usage/cost 统计
5. 权限审批 UI 与 whitelist/blacklist 规则
6. Codex 凭证导入、账号额度和 provider 中转配置继续增强

这样可以从“可交互 MVP”继续推进到“能自动执行工具的本地 Agent”。
