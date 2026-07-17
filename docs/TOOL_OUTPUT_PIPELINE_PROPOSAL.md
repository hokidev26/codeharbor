# 工具输出 Pipeline 设计提案

状态：讨论稿
日期：2026-07-17
适用项目：Autoto

## 1. 摘要

本文提议为 Autoto 增加一套工具输出 Pipeline 机制。它允许 Agent 临时捕获多个工具调用的完整结果，只把短预览和别名放入模型上下文，最后通过受限的过滤规则合并、筛选并返回真正需要的信息。

典型流程如下：

```text
StartPipeline
  ↓
Read / Grep / Bash / WebFetch 等工具正常执行
  ↓
完整结果保留用于审计，模型只收到 p1、p2……及短预览
  ↓
EndPipeline 使用受限规则筛选捕获结果
  ↓
只有最终筛选结果进入模型上下文
```

结论：Autoto 很适合加入该能力。它不会替代现有上下文压缩，而是主动减少当前轮工具输出对上下文窗口的占用，尤其适合大型代码库搜索、测试输出分析、日志排查和多文件探索。

## 2. 背景与问题

Autoto 当前拥有 `Read`、`Grep`、`Glob`、`Bash`、`WebFetch`、后台任务和动态工具等能力。工具结果执行后会作为结构化 `tool_result` 消息加入后续模型请求。

当前可能产生较大结果的工具包括：

- `Read` 单次最多返回 100 KB，见 `internal/tools/read.go`。
- `Bash` 最终结果最多返回 20 KB，流式输出最多发送 100 KB，见 `internal/tools/bash.go`。
- `Grep` 默认最多返回 100 条匹配，但单行长度和多次搜索仍可能形成较大上下文。
- Web、MCP 和动态工具也可能返回大量结构化或文本内容。

工具结果目前在 `internal/agent/loop.go` 的模型循环中被完整写入工具结果消息。项目已经实现上下文预算、旧消息摘要和工具结果省略，但这些机制主要在上下文接近限制或消息变旧后生效。

这会产生几个问题：

1. Agent 在探索阶段可能读取大量最终并不需要的信息。
2. 多个独立工具结果会分别占用上下文，模型最后只使用其中很小一部分。
3. 现有压缩机制会在后期省略旧结果，但无法减少当前轮刚产生的大输出。
4. 大量原始日志、测试输出和搜索结果可能降低模型对关键信息的注意力。
5. 使用 Bash 自行拼接 `grep | head | sort` 虽然可以减少输出，但会绕过专用工具，并增加命令权限与安全分析成本。

## 3. 适配性评估

### 3.1 有利条件

Autoto 的架构具备实现 Pipeline 的基础：

- 核心工具通过 `internal/tools/registry.go` 集中注册，新增控制工具较直接。
- 所有工具共享 `tools.Result`，结果包含 `Output`、`IsError` 和 `Meta`。
- `tools.Env` 已包含 `AgentID`、`RunID`、`CWD` 和 Store，可用于隔离 Pipeline 会话。
- 当前模型循环按顺序处理工具调用，便于为每个 Run 分配稳定的 `p1`、`p2` 等别名。
- 工具完整结果已经持久化到 Tool Call 记录，可以继续用于审计和 UI 查看。
- 后台任务已有输出分页、字节限制、截断和生命周期管理，可复用相关设计经验。
- Agent 已有 Run 完成、取消、替代和中断生命周期，可在这些边界自动释放 Pipeline 状态。

### 3.2 预期收益

Pipeline 对以下场景收益较高：

- 在大型代码库中执行多轮 `Glob`、`Grep` 和 `Read`。
- 同时读取多个配置、日志或测试文件后统一筛选。
- 运行测试、构建或静态检查后只提取失败信息。
- 分析 Git 状态、提交历史或大段 Diff 摘要。
- 调用返回内容较大的 Web、MCP 或动态工具。
- 子 Agent 或长任务需要控制上下文成本。

如果用户主要执行短小、单文件编辑，收益相对有限。因此建议将 Pipeline 作为 Agent 自动选择的上下文效率能力，而不是要求每个任务强制使用。

## 4. 目标与非目标

### 4.1 目标

1. 减少多工具探索产生的模型输入 token。
2. 保留完整工具结果的审计能力。
3. 提供确定性、受限且容易测试的过滤语法。
4. 不改变底层工具原有的权限和风险判断。
5. 按 Agent 和 Run 严格隔离捕获内容。
6. 对模型提供清晰、稳定的别名和短预览。
7. 在 Pipeline 未启用时不改变现有行为。

### 4.2 非目标

1. 不实现通用 Shell 管道解释器。
2. 不允许 Pipeline 规则执行程序、访问网络或修改文件。
3. 不替代 `Bash`、`Grep`、`Task` 或上下文摘要机制。
4. MVP 不支持嵌套 Pipeline。
5. MVP 不要求在服务器重启后恢复未结束的 Pipeline。
6. 不允许 Pipeline 降低底层工具的权限等级或绕过人工审批。

## 5. 建议的用户与模型接口

建议对模型暴露两个控制工具，底层共用一个 Pipeline Service。

### 5.1 `StartPipeline`

职责：为当前 Agent Run 开始一个工具结果捕获会话。

建议输入：

```json
{
  "label": "分析测试失败",
  "max_preview_chars": 100
}
```

建议输出：

```text
Pipeline 已启动。后续可捕获的工具结果将保存为 p1、p2……，模型只接收短预览。
```

行为约束：

- 必须存在有效 `RunID`。
- 同一个 Run 同时只允许一个活动 Pipeline。
- 不支持嵌套启动。
- `max_preview_chars` 应有较小且固定的上下限。

### 5.2 捕获后的普通工具结果

例如 `Read` 返回 30 KB 内容后，模型收到：

```text
已捕获为 p1
工具：Read
字节数：30720
错误：false
预览：package agent ...
```

完整结果仍应：

- 保存在 Tool Call 输出记录中。
- 可在工具活动详情中查看。
- 保持原有 `IsError` 语义。
- 遵循既有敏感数据处理和访问边界。

### 5.3 `EndPipeline`

职责：读取已捕获的别名，应用受限规则，并返回最终结果。

建议输入：

```json
{
  "rule": "from p1 p2 p3 | grep -i \"error|failed\" | sort | uniq | head -n 30",
  "format": "sections",
  "max_chars": 12000
}
```

建议输出包含：

- 使用的别名。
- 捕获项数量。
- 实际执行的规范化规则。
- 最终筛选结果。
- 是否发生截断。

规则解析或验证失败时，不应立即销毁 Pipeline，以便模型修正规则后重试。成功结束后应释放该 Run 的捕获状态。

可选增加 `discard` 参数，让模型在不需要结果时直接关闭并丢弃当前捕获会话。

## 6. 受限规则语法

MVP 建议只支持以下操作：

```text
from p1 p2
cat
从指定别名读取内容

grep PATTERN
grep -i PATTERN
grep -v PATTERN
按正则表达式保留或排除行

head -n N
tail -n N
限制行数

sort
sort -r
排序

uniq
去除相邻重复行

cut -d DELIMITER -f FIELDS
提取字段
```

说明：

- 如果规则未显式包含 `from`，可以使用输入参数中的默认别名列表。
- 每个操作都必须设置明确的输入、输出和复杂度限制。
- 正则表达式需要限制长度，并在可能的情况下避免灾难性回溯。
- `cut` 的字段数量和范围必须受限。
- `head`、`tail` 和最终字符数必须设置硬上限。

明确禁止：

- 命令替换。
- 文件重定向。
- 子 Shell。
- 环境变量展开。
- `eval`、`xargs` 或任意程序执行。
- 文件系统、网络、进程和数据库访问。
- 把规则字符串交给 `/bin/sh`、`bash` 或 `cmd.exe` 执行。

规则应由项目内独立解析器处理，而不是复用真实 Shell。

## 7. 建议架构

### 7.1 Pipeline Manager

建议增加一个 Run 级管理器，维护：

```text
(agentID, runID)
  ├─ active
  ├─ label
  ├─ nextAlias
  ├─ createdAt
  ├─ totalBytes
  └─ captures
       ├─ p1 → toolUseID、toolName、output、isError
       ├─ p2 → toolUseID、toolName、output、isError
       └─ ...
```

Manager 必须支持并发访问，即使当前模型循环顺序执行，也应为未来并行工具调用预留安全性。

建议职责：

- `Start`
- `IsActive`
- `Capture`
- `End`
- `Discard`
- `CloseRun`

### 7.2 控制工具

建议在 `internal/tools` 中增加：

```text
pipeline.go
pipeline_test.go
```

其中包含：

- `StartPipelineTool`
- `EndPipelineTool`
- 输入 Schema
- Pipeline Service 接口
- 受限规则的调用入口

控制工具风险建议标记为 `RiskRead`，因为它们本身不修改工作区，也不执行外部程序。

### 7.3 Agent Loop 集成

只注册两个普通工具还不够，因为普通工具无法自动拦截其他工具的结果。

建议在 `internal/agent/loop.go` 中，普通工具执行完成、完整结果已经记录，但尚未生成模型可见 `tool_result` 消息时进行转换。

当前相关流程位于模型循环执行工具并创建工具结果消息的位置。建议逻辑为：

```go
rawResult := executeToolForLoop(...)
modelResult := pipeline.ProcessResult(agentID, runID, call, rawResult)

// Tool Call 审计记录继续保留 rawResult。
// 发给模型的 tool_result 使用 modelResult。
```

处理规则：

- `StartPipeline` 和 `EndPipeline` 自身结果不捕获。
- 未开启 Pipeline 时直接返回原始结果。
- 开启后，将普通工具结果保存为别名并返回短预览。
- 权限拒绝和工具错误仍保留原有错误状态。
- 工具活动 UI 仍可以展示已有的受限结果预览。

这种集成方式只影响模型可见结果，不需要改变所有现有工具实现，也不会影响外部 API 直接执行工具的调用者。

### 7.4 生命周期清理

以下情况必须调用 `CloseRun`：

- Run 正常完成。
- Run 被用户取消。
- Run 被新请求替代。
- Run 执行失败。
- Agent 被删除或 Runner 关闭。
- Pipeline 超过最大存活时间。

清理操作必须幂等。

## 8. 数据持久化策略

### 8.1 MVP 建议

MVP 使用内存中的 Run 级状态：

优点：

- 实现简单。
- 不重复持久化可能敏感的大段输出。
- Pipeline 本身只是短期上下文优化能力。

缺点：

- 服务器重启后活动 Pipeline 无法继续。
- 无法支持跨进程 Runner。

服务器重启后，未结束 Pipeline 应明确失败并提示重新开始，而不是静默返回不完整数据。

### 8.2 后续持久化方案

如果未来需要恢复，可以只持久化：

- Pipeline 会话状态。
- 别名到 `toolUseID` 的映射。
- 顺序和大小元数据。

完整输出可以从现有 Tool Call 输出记录读取，避免保存第二份副本。

## 9. 限制与资源保护

建议初始限制：

| 项目 | 建议默认值 |
|---|---:|
| 每个 Run 的活动 Pipeline | 1 |
| 最大捕获项 | 64 |
| 单项模型预览 | 100 字符 |
| Pipeline 总捕获量 | 2–4 MB |
| 规则长度 | 4 KB |
| 规则操作数 | 16 |
| 最终返回内容 | 12 KB |
| 最大输出行数 | 1,000 |
| 空闲超时 | 10 分钟 |

具体数值可以根据真实 Dogfood 数据调整，但必须存在硬上限。

当达到限制时：

- 不应导致整个 Agent Run 崩溃。
- 应返回结构化、可理解的错误。
- 已有别名应继续可用。
- 应明确指出哪些内容未捕获或被截断。

## 10. 安全与权限

### 10.1 不改变底层工具权限

Pipeline 只处理已经完成权限判断的工具结果：

- `Read` 仍是读取风险。
- `Bash` 仍需要执行权限或人工批准。
- 写入和危险工具仍遵守现有策略。
- Pipeline 不能把多个操作包装成一次批准以规避逐工具审计。

### 10.2 严格隔离

所有读取和结束操作必须同时校验：

- `AgentID`
- `RunID`
- Pipeline 会话状态

禁止一个 Agent 或 Run 读取另一个 Run 的别名。

### 10.3 输出与敏感数据

Pipeline 不应创造新的数据访问能力，但会增加结果缓存，因此需要：

- 遵循现有工具输出访问控制。
- 对 UI 和事件中的预览继续执行长度限制。
- 不把捕获内容写入日志。
- 错误消息不得包含完整敏感结果。
- 清理时释放所有内存引用。

### 10.4 命名冲突

项目当前已使用 `Pipeline` 表示 Shell 命令管道，例如命令事实分析中的 `Pipeline` 字段。

为避免内部概念混淆，建议内部服务命名为：

- `ToolOutputPipeline`
- `ResultPipeline`
- `ContextPipeline`

对模型暴露的名称仍可使用 `StartPipeline` 和 `EndPipeline`。

## 11. UI 与可观测性

MVP 可以不新增复杂 UI，因为现有工具活动已经展示工具调用、状态、结果预览和截断状态。

建议至少补充以下可观测信息：

- Pipeline 启动事件。
- 捕获别名，例如 `p3`。
- 捕获工具名称和原始字节数。
- Pipeline 结束事件。
- 最终规则和输出是否截断。

UI 可以显示：

```text
Read 已完成 · 结果捕获为 p2 · 48.1 KB
```

完整输出仍通过原有工具详情查看，模型消息中只显示别名和短预览。

## 12. 错误处理

建议定义稳定错误类型：

- `pipeline_not_active`
- `pipeline_already_active`
- `pipeline_run_required`
- `pipeline_alias_not_found`
- `pipeline_limit_exceeded`
- `pipeline_rule_invalid`
- `pipeline_operation_not_allowed`
- `pipeline_output_truncated`
- `pipeline_state_lost`

行为建议：

- Start 失败：不创建部分状态。
- Capture 失败：返回原始工具结果或明确的受限预览，不得静默丢失。
- End 规则错误：保留活动 Pipeline，允许重试。
- End 成功：先生成最终结果，再原子关闭会话。
- Run 结束：无论 End 是否调用都强制清理。

## 13. 测试计划

### 13.1 单元测试

1. Start 后依次捕获 `p1`、`p2`。
2. 未 Start 时工具结果保持不变。
3. 控制工具自身不会被捕获。
4. 同一 Run 不允许嵌套 Start。
5. 不同 Agent 和 Run 之间严格隔离。
6. 捕获项数、总字节和预览长度限制有效。
7. UTF-8 截断不会产生无效字符串。
8. `grep`、`head`、`tail`、`sort`、`uniq` 和 `cut` 行为确定。
9. 禁止命令替换、重定向和任意程序执行。
10. End 解析失败后仍可重试。
11. End 成功后状态被释放。
12. Run 取消、失败和替代时状态被清理。
13. 底层工具风险和批准流程不受影响。
14. 工具错误结果仍保持 `IsError` 语义。

### 13.2 Agent Loop 集成测试

模拟 Provider 按以下顺序调用：

```text
StartPipeline
Read
Grep
EndPipeline
```

验证：

- Tool Call 数据库记录包含完整原始结果。
- 模型历史中的中间结果只包含别名和预览。
- EndPipeline 返回经过过滤的内容。
- 最终请求 token 估算显著小于未使用 Pipeline 的请求。
- 现有工具事件和审计记录没有回归。

### 13.3 安全测试

- 尝试注入 `; rm ...`。
- 尝试 `$(...)`、反引号和环境变量展开。
- 尝试跨 Run 读取别名。
- 尝试构造超长正则、字段列表和输出。
- 尝试在 Pipeline 中绕过 Bash 审批。

所有场景都应失败关闭或返回受限错误，不得执行外部命令。

## 14. 分阶段实施建议

### 阶段一：核心 MVP

- 内存 Pipeline Manager。
- `StartPipeline` 与 `EndPipeline`。
- Run 级隔离和生命周期清理。
- `from`、`grep`、`head`、`tail`、`sort`、`uniq`。
- 基础单元测试和 Agent Loop 集成测试。

### 阶段二：产品体验

- 工具活动中的捕获别名和大小展示。
- `cut` 与更好的 sections 输出格式。
- 使用量、节省字符数和截断指标。
- 根据模型能力调整工具描述。

### 阶段三：耐久性与高级能力

- Pipeline 会话持久化。
- 服务器重启恢复。
- 别名引用已有 Tool Call 输出，避免重复存储。
- 后台任务输出与 Pipeline 的安全组合。
- 基于真实使用数据自动建议或自动启用 Pipeline。

## 15. 需要评审者重点确认的问题

1. Pipeline 是否只对模型循环生效，还是也应开放给外部工具执行 API？
2. MVP 是否接受服务器重启后丢失活动 Pipeline？
3. 完整捕获内容应保存在内存，还是只保存 Tool Call 引用？
4. End 规则错误时是否保持 Pipeline 活动？本文建议保持。
5. 底层工具发生错误时，是否仍分配别名？本文建议分配并保留错误状态。
6. 是否需要第三个 `CancelPipeline` 工具，还是由 `EndPipeline` 的 `discard` 参数承担？
7. 默认总捕获量和最终返回上限应设置为多少？
8. 是否需要在第一阶段同步实现前端状态展示？

## 16. 最终建议

建议加入工具输出 Pipeline，并优先采用“小型、受限、Run 级、默认内存实现”的方案。

它与 Autoto 当前架构匹配，能直接解决多工具探索造成的当前轮上下文膨胀问题。实现时最重要的原则是：

1. 完整结果继续保留用于审计。
2. 只转换发给模型的结果，不侵入每个现有工具。
3. Pipeline 规则绝不交给真实 Shell 执行。
4. 不改变底层工具权限和审批边界。
5. 所有状态严格绑定 Agent 与 Run，并在生命周期结束时清理。

在这些约束下，该功能具备明确收益，实施复杂度中等，适合作为 Autoto 的上下文效率增强能力进入后续评审与实现阶段。
