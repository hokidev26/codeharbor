# Subagent 前端收纳与按需详情计划

状态：计划稿  
日期：2026-07-19  
适用项目：Autoto

## 1. 摘要

Autoto 已经具备完整的 Subagent 核心链路，包括 `Agent` 工具、持久化后台任务、子 Agent / 子 Run、角色与权限约束、按角色选择模型、取消与等待、`ContextAsk` 查询，以及前端后台任务面板。

本次计划不重新实现 Subagent，而是优化父 Agent 会话中的展示方式：

1. 父会话只展示紧凑、可审计的子任务摘要。
2. 不在父会话中自动加载或嵌套展示子 Agent 的实际工具调用。
3. 子任务详情、子 Agent 和子 Run 通过显式点击按需打开。
4. 已完成任务默认收起；执行中、等待审批和失败状态保持足够醒目。
5. 明确区分“`Agent` 工具已成功派发”和“子 Agent 任务已执行完成”这两个不同状态。

结论：采用“摘要优先、渐进展开、显式查看子 Run”的方案，保留现有后端安全边界和审计能力，同时减少父对话噪声、浏览器渲染负担和不必要的数据请求。

## 2. 背景与现状

### 2.1 已有后端能力

当前代码已经包含以下能力：

- `internal/tools/agent_task.go`
  - 注册名为 `Agent` 的工具。
  - 创建持久化后台 Agent 任务并立即返回任务句柄。
  - 保存 `ParentRunID` 和 `ParentToolUseID`，可将父工具调用与后台任务关联。
- `internal/background/agent.go`
  - 创建独立子 Agent 和子 Run。
  - 继承或收窄父 Agent 权限，不允许扩大权限。
  - 将子任务状态保存为持久化后台任务结果。
- `internal/agentrole/role.go`
  - 支持 `general`、`executor`、`explorer`、`reviewer`、`tester`、`plan` 和 `search` 等角色。
  - 对只读角色强制使用只读权限。
- `internal/agent/loop.go`
  - 支持 Subagent 专用模型和模型池。
  - 未单独配置时可回退到父 Agent 模型或默认模型。
- `internal/tools/context_ask.go`
  - 父 Agent 可以基于持久化子 Run 查询结果。
  - 不需要把子 Agent 的原始工具调用全部塞回父 Agent 上下文。
- `internal/db/background_tasks.go`
  - 后台任务包含 `parentToolUseId`、`childAgentId`、`childRunId`、状态、时间、公开摘要和错误信息。

现有安全约束应保持不变：

- 只有根 Agent 可以创建第一层 Subagent。
- Subagent 不能继续创建下一层 Subagent。
- 子 Agent 权限不得超过父 Agent。
- 未知角色必须拒绝，不能回退到更宽松的通用角色。
- 子 Agent 的成功状态不能替代主 Agent 对关键结果的独立验证。

### 2.2 已有前端能力

当前前端已经包含：

- `internal/server/static/modules/chat-rendering.mjs`
  - 通用工具活动卡片和工具活动分组。
  - 每张工具卡的输入、输出和 Diff 已经使用 `<details>` 收纳。
  - 工具活动分组当前默认带有 `open`，因此整组默认展开。
- `internal/server/static/modules/background-tasks.mjs`
  - 显示后台任务列表、状态、时间、错误和分页输出。
  - 支持取消、等待、打开子 Agent 和打开子 Run。
  - 数据按当前父 Agent 隔离。
- `internal/server/static/modules/app-main.mjs`
  - 已经具备从后台任务跳转到子 Agent 或子 Run 的导航入口。

### 2.3 当前问题

1. `Agent` 工具仍使用通用工具卡片，没有专属的子任务摘要布局。
2. 通用工具卡更强调输入 JSON 和工具输出，不适合表达“任务委派”语义。
3. `Agent` 工具调用完成只表示后台任务已成功创建，不代表子 Agent 已完成；当前通用状态容易让用户误解。
4. 工具活动分组默认展开，长会话中容易占用大量垂直空间。
5. 如果未来直接把子 Agent 的工具调用嵌入父会话，会造成重复数据、额外请求和视觉噪声。
6. 子任务 Prompt 可能很长，不应直接作为紧凑卡片标题，也不应在默认展开状态中暴露全部内容。

## 3. 目标与非目标

### 3.1 目标

1. 为 `Agent` 工具提供专属的紧凑任务卡片。
2. 使用 `parentToolUseId` 将父工具调用与后台任务状态可靠关联。
3. 在父会话展示角色、描述、模型、状态、耗时、验收条件数量和导航入口。
4. 已完成的子任务默认收起，活动或异常状态保持醒目。
5. 父会话默认不请求子 Run 的工具调用列表。
6. 用户显式打开子 Agent 或子 Run 后，再进入现有独立详情页面查看完整记录。
7. 保留现有通用工具卡作为关联失败时的安全降级方案。
8. 支持简体中文、繁体中文和英文文案。
9. 保持桌面端、窄窗口和移动端可用，并满足键盘操作和基本可访问性要求。

### 3.2 非目标

1. 不重写 `Agent` 工具或后台任务执行器。
2. 不改变 Subagent 角色、权限、模型选择和禁止嵌套规则。
3. 不在父会话中复制子 Agent 的完整消息、推理内容或工具调用记录。
4. 不自动生成新的 AI 摘要请求，以免增加模型成本和延迟。
5. 不把子任务工具调用数量作为第一阶段必需字段；现有数据没有可靠提供时不猜测。
6. 不新增多层 Agent 树或无限嵌套导航。
7. 不用前端隐藏替代后端权限、访问控制和数据隔离。
8. 第一阶段不修改全部普通工具卡的默认展开策略，只处理 Subagent 相关展示和必要的分组行为。

## 4. 设计原则

### 4.1 摘要优先

父会话只显示完成判断所需的最小信息：

- 子任务描述
- Subagent 角色
- 模型
- 后台任务状态
- 开始时间或耗时
- 验收条件数量
- 子 Agent / 子 Run 入口
- 错误摘要（仅异常时）

不得在紧凑状态直接展示完整 Prompt、完整工具输入、完整工具输出或子 Run 工具调用列表。

### 4.2 渐进披露

信息分为三层：

1. **父会话紧凑卡片**：默认可见，信息最少。
2. **后台任务详情面板**：用户点击后加载现有任务输出和任务操作。
3. **子 Agent / 子 Run 页面**：用户明确进入后查看完整消息与工具活动。

### 4.3 状态必须语义准确

需要同时表达两个状态：

- 父 `Agent` 工具状态：是否成功创建后台任务。
- 子后台任务状态：排队、运行、等待审批、成功、失败、取消或中断。

父工具调用的 `completed` 不应直接翻译成“子任务已完成”。建议在专属卡片中将其表达为“已派发”，并以后台任务状态作为主要状态。

### 4.4 默认不加载子工具调用

父会话渲染过程中不得自动调用类似以下子 Run 工具详情接口：

```text
/api/agents/{childAgentId}/runs/{childRunId}/tool-calls
```

只有用户显式打开子 Run 后，子 Agent 页面才按现有逻辑加载自己的工具调用。

### 4.5 保持可审计与可降级

- 父工具调用记录、后台任务、子 Agent 和子 Run 仍然持久化。
- 关联失败时显示通用 `Agent` 工具卡，不隐藏真实错误。
- 数据不完整时使用“状态未知”或“等待任务信息”，不能伪造完成状态。

## 5. 建议交互

### 5.1 已完成状态

```text
▸ Explorer 子任务 · 检查登录流程
  已完成 · 32 秒 · codex:gpt-5.4-mini

  [查看任务] [打开子 Agent] [打开 Run]
```

行为：

- 默认收起。
- 不显示实际 `Read`、`Grep`、`Bash` 等子工具调用。
- 点击“查看任务”打开现有后台任务面板。
- 点击“打开子 Agent”进入子 Agent 会话。
- 点击“打开 Run”进入子 Run 回顾。

### 5.2 执行中状态

```text
▾ Reviewer 子任务 · 审查权限边界
  运行中 · codex:gpt-5.5

  子 Agent 正在独立执行任务。
  [查看任务] [取消]
```

行为：

- 活动任务可默认展开简短状态。
- 只显示任务级进度，不流式嵌入子 Agent 的实际工具调用。
- 取消操作继续使用现有后台任务取消接口。

### 5.3 等待审批状态

```text
▾ Executor 子任务 · 运行修复验证
  等待审批

  子 Agent 中存在等待处理的受限工具调用。
  [打开子 Agent] [查看任务]
```

行为：

- 自动展开并使用警告色。
- 不在父卡片复制审批命令内容。
- 用户进入对应子 Agent 后，通过现有审批界面处理。

### 5.4 失败或中断状态

```text
▾ Tester 子任务 · 执行回归测试
  失败 · 18 秒

  测试任务未完成：子 Run 返回失败状态。
  [查看错误] [打开 Run]
```

行为：

- 自动展开错误摘要。
- 错误文本必须经过现有长度限制和转义。
- 不将失败自动视为主任务失败，由主 Agent决定后续处理。

## 6. 数据关联方案

### 6.1 主关联键

使用现有字段进行关联：

```text
ToolCall.toolUseId
        =
BackgroundTask.parentToolUseId
```

后台任务进一步提供：

```text
BackgroundTask.id
BackgroundTask.status
BackgroundTask.publicSummary
BackgroundTask.childAgentId
BackgroundTask.childRunId
BackgroundTask.startedAt
BackgroundTask.completedAt
BackgroundTask.errorCode
BackgroundTask.errorMessage
```

### 6.2 前端派生状态

建议在前端维护：

```text
backgroundTaskByParentToolUseId: Map<toolUseId, task>
```

该索引由以下数据源更新：

1. 当前 Agent 的 live snapshot。
2. `GET /api/agents/{id}/background-tasks`。
3. `task.created`、`task.status` 和 `task.completed` WebSocket 事件。
4. 单个后台任务详情刷新结果。

Agent 切换时必须清空索引，并继续使用现有 generation / stale request 防护，避免旧 Agent 请求回填当前页面。

### 6.3 公开摘要字段

第一阶段仅使用现有公开摘要：

```json
{
  "description": "检查登录流程",
  "subagentType": "explorer",
  "model": "codex:gpt-5.4-mini",
  "acceptanceCount": 2
}
```

紧凑卡片不得从私有 Payload 中提取或显示完整 Prompt。工具活动详情中现有输入 JSON 仍可作为审计降级入口，但必须默认收起。

### 6.4 服务端变更门槛

优先复用现有 API 和事件。实施前先验证 `parentToolUseId` 是否在以下路径完整透传：

- live snapshot
- 后台任务列表 API
- `task.*` WebSocket 事件
- 单任务详情 API

只有发现某条路径缺少该字段时，才补充经过清洗的关联字段。预计不需要数据库迁移，因为字段已经存在并持久化。

## 7. 前端组件方案

### 7.1 Agent 工具识别

在 `chat-rendering.mjs` 中增加明确判断：

```text
isAgentToolActivity(tool)
```

仅对规范化工具名精确识别 `Agent`，避免把普通名称中含有 `agent` 的动态工具误判为 Subagent。

### 7.2 专属规范化结果

增加一个只用于展示的派生对象，建议包含：

```text
role
description
model
reasoningEffort
acceptanceCount
taskId
taskStatus
childAgentId
childRunId
startedAt
completedAt
durationMs
errorMessage
```

所有文本继续经过现有 `escapeHtml`、`escapeAttr`、长度限制和状态白名单处理。

### 7.3 专属渲染器

建议增加：

```text
renderAgentTaskActivityCardHTML(tool, task, options)
```

通用入口按类型分流：

```text
Agent 工具 + 已有关联任务
  -> 专属子任务卡片

Agent 工具 + 暂无关联任务
  -> “已派发 / 等待任务信息”卡片

其他工具或关联解析失败
  -> 现有 renderToolActivityCardHTML
```

### 7.4 展开策略

建议按后台任务状态决定默认展开：

| 状态 | 默认行为 |
| --- | --- |
| `queued` / `running` | 展开简短状态 |
| `waiting_approval` | 展开并突出提醒 |
| `succeeded` / `completed` | 收起 |
| `failed` / `error` | 展开错误摘要 |
| `canceled` / `cancelled` / `interrupted` | 展开终止说明 |
| 未知或关联未完成 | 收起并显示等待信息 |

不建议第一阶段改变所有普通工具活动组的默认展开行为。可以仅让包含 Subagent 专属卡片的分组使用状态驱动策略，降低回归范围。

### 7.5 导航与任务面板

复用现有能力：

- “查看任务”：选中对应后台任务并打开后台任务面板。
- “打开子 Agent”：调用现有 `onNavigateAgent(childAgentId)`。
- “打开 Run”：调用现有 `onNavigateRun(childAgentId, childRunId)`。
- “取消”：调用现有后台任务取消接口。

如果现有控制器缺少“按任务 ID 打开面板”的公开方法，应增加最小接口，而不是复制后台任务加载逻辑。

## 8. 实施阶段

### 阶段 0：数据契约验证

1. 核对后台任务列表、snapshot 和 `task.*` 事件是否均包含 `parentToolUseId`。
2. 核对父工具调用、后台任务和子 Run 的状态更新时间顺序。
3. 确认 Agent 切换和 Run 切换时旧请求不会污染新页面。
4. 记录缺失字段；只有确有缺失才调整服务端投影。

交付物：明确的数据字段表和不需要数据库迁移的证据。

### 阶段 1：专属紧凑卡片

1. 增加 `Agent` 工具精确识别。
2. 从工具输入和公开任务摘要派生角色、描述和模型。
3. 增加专属图标、标题、状态徽章和耗时。
4. 将完整输入 / 输出继续放在默认收起的审计详情中。
5. 保留通用工具卡降级路径。

交付物：静态和历史 Run 中的 `Agent` 工具不再显示为普通工具卡。

### 阶段 2：父工具与后台任务实时关联

1. 在后台任务控制器中建立 `parentToolUseId` 索引。
2. 将 snapshot、列表 API 和实时事件统一写入索引。
3. 子任务状态变化时只刷新对应卡片或工具活动区域。
4. 明确区分“已派发”和“子任务完成”。
5. 对乱序、重复和过期事件保持幂等。

交付物：排队、运行、成功、失败、取消和等待审批状态能够实时更新。

### 阶段 3：按需详情与导航

1. 接通“查看任务”。
2. 复用“打开子 Agent”和“打开 Run”。
3. 验证父会话初次渲染不请求子 Run 工具调用接口。
4. 用户点击进入子 Run 后，继续使用现有工具活动加载逻辑。
5. 子 Agent 或子 Run 尚未创建时禁用对应按钮并显示明确状态。

交付物：父会话保持紧凑，完整审计详情仍然可达。

### 阶段 4：样式、国际化与移动端

1. 增加专属 Subagent 卡片样式。
2. 完成简体中文、繁体中文和英文文案。
3. 验证长描述、长模型名、窄窗口和移动端换行。
4. 验证键盘聚焦、`<details>`、按钮标签和状态可读性。
5. 避免依赖颜色作为唯一状态提示。

交付物：桌面端和移动端均可稳定使用。

### 阶段 5：测试与回归

1. 增加前端单元测试。
2. 增加必要的服务端投影测试（仅当阶段 0 发现字段缺失）。
3. 运行目标模块测试。
4. 运行完整 `make check`。
5. 手动验证父 Agent 创建 Subagent 的真实工作流。

交付物：自动化测试和手动验收记录。

## 9. 预计修改文件

主要前端文件：

- `internal/server/static/modules/chat-rendering.mjs`
- `internal/server/static/modules/chat-rendering.test.mjs`
- `internal/server/static/modules/background-tasks.mjs`
- `internal/server/static/modules/background-tasks.test.mjs`
- `internal/server/static/modules/app-main.mjs`
- `internal/server/static/modules/messages-chat-rendering-extra.mjs`
- `internal/server/static/modules/messages-background-tasks.mjs`
- `internal/server/static/styles.css`

仅在数据字段缺失时可能修改：

- `internal/server/background_tasks.go`
- `internal/db/live_snapshot.go`
- 对应 Go 测试文件

预计不需要修改：

- Subagent 数据库表结构
- `Agent` 工具执行协议
- 角色权限合同
- Provider 接口
- 子 Agent 工具调用持久化结构

## 10. 测试计划

### 10.1 前端单元测试

至少覆盖：

1. 只有规范工具名 `Agent` 会进入专属渲染器。
2. `parentToolUseId` 能正确关联后台任务。
3. 完成状态默认收起。
4. 运行、审批和失败状态按规则展开。
5. 父工具 `completed` 不会误显示成子任务完成。
6. 描述、模型名和错误内容正确转义。
7. 缺少 `childAgentId` 或 `childRunId` 时按钮正确禁用。
8. 关联失败时回退到通用工具卡。
9. Agent 切换后旧请求和旧事件不能回填。
10. 父会话渲染不会请求子 Run 的工具调用接口。
11. 点击“查看任务”只加载对应后台任务详情。
12. 点击“打开子 Agent / Run”调用正确导航参数。

### 10.2 服务端测试

如果需要补充字段，至少覆盖：

1. 后台任务列表返回 `parentToolUseId`。
2. live snapshot 返回相同关联值。
3. `task.created`、`task.status` 和 `task.completed` 不泄露私有 Payload 或完整 Prompt。
4. 用户只能读取有权访问的父 Agent 后台任务。
5. 子 Agent 和父 Agent 的工具调用仍按 Agent ID 隔离。

### 10.3 手动验收流程

```text
根 Agent 发起 Agent 工具
  -> 父会话出现紧凑子任务卡片
  -> 状态从已派发 / 排队更新到运行中
  -> 父会话没有出现子 Agent 的 Read/Grep/Bash 明细
  -> 点击查看任务可打开后台任务面板
  -> 点击打开子 Agent 可进入子会话
  -> 点击打开 Run 后才加载子 Run 工具调用
  -> 子任务结束后父卡片更新为完成并默认收起
```

还需分别验证：

- 等待审批
- 失败
- 取消
- 中断
- 子 Agent / Run 创建前的短暂状态
- 页面刷新后的状态恢复
- WebSocket 重连和 snapshot 恢复
- 移动端窄屏

## 11. 验收标准

以下条件全部满足才视为完成：

1. 父会话能够显示 Subagent 角色、描述、模型和真实后台任务状态。
2. `Agent` 工具“已派发”和子任务“已完成”不会混淆。
3. 已完成子任务默认收起。
4. 等待审批和失败状态不会被隐藏。
5. 父会话默认不会加载子 Run 的实际工具调用内容。
6. 用户可以显式打开后台任务、子 Agent 和子 Run。
7. 缺失或乱序数据不会导致错误的成功状态。
8. 子任务 Prompt 不会出现在默认紧凑摘要中。
9. 所有动态文本均正确转义并受长度限制。
10. 简体中文、繁体中文和英文文案齐全。
11. 桌面端和移动端样式可用。
12. 不改变既有权限、审批和 Subagent 安全边界。
13. 目标测试和完整检查通过。

## 12. 风险与缓解措施

### 12.1 工具状态与任务状态混淆

风险：父 `Agent` 工具很快完成，但子任务仍在运行。

缓解：使用两个明确语义；卡片主状态来自后台任务，工具状态仅表示“派发成功或失败”。

### 12.2 实时事件乱序

风险：`task.completed`、列表刷新和 snapshot 到达顺序不同，旧状态覆盖新状态。

缓解：沿用任务 `revision`、Agent generation 和现有 stale request 防护；只接受更新版本。

### 12.3 Prompt 或私有数据泄露

风险：直接使用 Agent 工具输入作为卡片摘要会显示完整 Prompt。

缓解：紧凑卡片只使用公开摘要中的 `description`、角色、模型和数量字段；完整 Prompt 不默认展开，也不加入任务事件。

### 12.4 为展示而增加模型调用

风险：自动生成子任务摘要会增加成本、延迟和失败点。

缓解：第一阶段不新增摘要模型调用；使用现有结构化状态和用户提供的描述。

### 12.5 前端状态重复

风险：聊天渲染控制器和后台任务控制器各自保存一份不一致的数据。

缓解：后台任务控制器作为任务状态事实源，对外提供只读查询或订阅接口；聊天渲染只消费规范化任务状态。

### 12.6 完成任务全部折叠导致问题不醒目

风险：失败或审批任务与普通完成任务一起被收起。

缓解：仅成功终态默认收起；失败、审批、取消和中断使用不同展开规则与文字标签。

## 13. 回滚方案

本次改动应优先保持为前端渐进增强：

1. 专属渲染只在 `toolName === "Agent"` 且数据可识别时启用。
2. 删除专属分支后可以立即回退到现有通用工具卡。
3. 保留现有后台任务面板和子 Agent / Run 导航，不修改持久化数据。
4. 如果服务端仅补充公开关联字段，回滚时可停止前端消费；字段本身保持向后兼容。
5. 不做数据库迁移，因此不涉及数据回滚。

## 14. 建议实施顺序

建议按以下顺序执行，避免先做样式后发现数据无法关联：

1. 验证 `parentToolUseId` 数据链路。
2. 建立后台任务关联索引。
3. 实现专属 Agent 任务卡片。
4. 接入实时状态更新。
5. 接入任务面板与子 Agent / Run 导航。
6. 完成状态驱动的展开规则。
7. 补齐样式与三语言文案。
8. 完成单元测试和手动流程验证。
9. 运行完整检查并审查最终 Diff。

## 15. 后续可选增强

以下能力不属于本次范围，可在真实使用数据证明有需要后再规划：

- 父卡片显示子 Run 工具调用总数，但不显示明细。
- 显示子任务 token 和成本摘要。
- 用户显式请求后加载只读子 Run 摘要，而不是完整工具调用。
- 多个并行 Subagent 的分组视图。
- 按角色、状态或父 Run 过滤后台任务。
- 子任务完成后的通知偏好。
- 在不泄露 Prompt 的前提下提供更明确的任务结果摘要字段。

这些增强仍应遵守同一原则：父会话只展示摘要，完整子 Agent 过程必须通过显式导航按需查看。
