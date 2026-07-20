# Autoto 桌面框架评估：Wails 与 Tauri

核对日期：2026-07-20

## 1. 背景与问题

本次讨论源于一篇基于 Wails v3、WebView 和 Go 的桌面端脚手架文章，以及一条评价：

> Wails 这类方案的原生部分比较“毛坯”，Tauri 则可以直接上手。

这里的 `walis` 应为 `Wails`。

这句话讨论的不是 Web 页面本身是否好看，也不是 Wails 能不能调用系统 API，而是两套框架在以下方面的“开箱即用程度”：

- 原生文件和目录对话框；
- 托盘、菜单、全局快捷键和单实例；
- 自启动、深度链接、通知和剪贴板；
- 窗口尺寸与位置持久化；
- 应用更新、签名和打包；
- 子进程、文件系统、数据库和安全存储；
- 权限声明、插件安装、文档和跨平台一致性。

## 2. “原生比较毛坯”是什么意思

“毛坯”不是严格的技术术语，通常包含四层意思。

### 2.1 核心能力存在，但产品级封装不够完整

Wails 可以提供窗口、菜单、托盘、系统对话框、Go 与 JavaScript 绑定等桌面能力，但开发者经常仍要自己补齐：

- 统一的前端调用适配层；
- 不同操作系统的行为差异；
- 失败和取消状态；
- 应用生命周期和异常退出处理；
- 自动更新、单实例、自启动等产品功能；
- 完整的测试和发布流程。

因此，“毛坯”更接近“基础结构已经有了，但装修和家电需要自己配”，而不是“框架没有原生能力”。

### 2.2 现成插件和标准组合相对少

Tauri 2 官方插件覆盖了很多常见桌面需求，例如：

- Autostart；
- Clipboard；
- Deep Link；
- Dialog；
- File System；
- Global Shortcut；
- Logging；
- Notification；
- Opener；
- Shell；
- Single Instance；
- SQL、Store 和 Stronghold；
- Updater；
- Window State。

对开发者而言，这意味着很多功能可以按照同一种流程安装插件、注册插件、声明权限，然后从 JavaScript 或 Rust 调用。所谓“Tauri 可以直接上手”，主要是在说这种标准化和插件化体验。

### 2.3 文档、工具链和生态成熟度不同

截至 2026-07-20，Wails v3 官方仍明确标记为 Alpha。官方说明其 API 已经“相当稳定”，也有生产应用，但文档和工具链仍在继续完善。

这会带来几个现实影响：

- 文档可能不完整或调整；
- 示例和最佳实践数量相对有限；
- 某些桌面能力需要阅读源码或自行封装；
- 升级时需要承担更高的适配成本；
- 团队需要更强的 Go 和平台 API 处理能力。

Tauri 2 已形成更完整的官方插件目录、权限模型和安装流程，因此在“我要马上加一个桌面功能”这一点上通常更顺手。

### 2.4 “原生”不等于原生控件 UI

Wails 和 Tauri 都主要使用系统 WebView 渲染前端界面：

- Windows 通常使用 WebView2；
- macOS 使用 WKWebView；
- Linux 使用系统 WebKit 相关实现。

两者都不是传统意义上使用 WinUI、AppKit 或 GTK 原生控件绘制全部界面的框架。它们的“原生能力”主要指：

- 原生窗口；
- 系统菜单和托盘；
- 文件对话框；
- 通知、快捷键和剪贴板；
- 文件系统和子进程；
- 操作系统生命周期与打包。

因此，“Wails 原生比较毛坯”不应被理解为“Wails 的 WebView 页面一定更丑”或“Tauri 自动生成原生控件界面”。界面质量仍主要取决于前端实现。

## 3. 这条评价是否准确

结论是：**有一定道理，但只说了一半。**

### 3.1 对新项目而言，这条评价大体成立

如果从零开始做一个需要以下功能的桌面产品：

- 系统托盘；
- 自动更新；
- 单实例；
- 自启动；
- 全局快捷键；
- 原生通知；
- 文件系统权限；
- 安全存储；
- 窗口状态恢复；

Tauri 2 的官方插件体系通常能降低前期集成成本。开发者可以更快找到标准插件、权限标识、平台支持表和示例。

### 3.2 但“Tauri 直接上手”不等于没有成本

Tauri 的成本主要转移到了以下方面：

- Rust 工具链和依赖管理；
- `src-tauri` 工程；
- Rust 与前端之间的命令接口；
- Capability 和 Permission 配置；
- 不同窗口、WebView 和平台的权限声明；
- 插件版本兼容和发布配置；
- 如果主业务不是 Rust，还需要管理 sidecar 或进程间通信。

Tauri 2 的 Capability 模型能提供更细的最小权限边界，但也要求项目明确维护“哪个窗口可以调用哪个能力”。对于安全要求高的项目，这是优点；对于只想快速弹出一个窗口的小项目，它也是额外配置成本。

### 3.3 对已经使用 Go 的项目，Wails 的优势会明显放大

Wails 的核心优势不是插件数量，而是：

- 后端直接使用 Go；
- 可以复用现有 Go package；
- Go 与 JavaScript 绑定自动生成；
- 不需要把核心业务改写为 Rust；
- 可以避免同时维护 Go 和 Rust 两套后端工程。

所以“哪个更容易上手”不能脱离现有技术栈判断。

## 4. Wails 与 Tauri 的实际对比

| 维度 | Wails v3 | Tauri 2 |
|---|---|---|
| 核心后端语言 | Go | Rust |
| 当前成熟度 | v3 仍为 Alpha，API 相对稳定 | v2 正式生态和官方插件较完整 |
| 系统 WebView | 是 | 是 |
| 前端技术 | 可使用主流 Web 前端 | 可使用主流 Web 前端 |
| Go 项目复用 | 很强，可直接复用 package | 较弱，通常需要 sidecar 或重新实现 Rust 命令 |
| 官方插件覆盖 | 核心原生能力存在，但标准插件组合相对少 | 官方插件覆盖常见桌面和移动能力 |
| 权限模型 | 更依赖应用自身服务边界和 Go 端校验 | Capability/Permission 模型较完整但配置更多 |
| 原生对话框 | 支持 | 官方 Dialog 插件，安装和调用流程标准化 |
| 自动更新、单实例、自启动 | 需要核对版本能力并进行更多工程整合 | 有对应官方插件或标准方案 |
| IPC | Go 与 JavaScript 绑定、内存 IPC | Rust Command/Plugin IPC |
| 团队学习成本 | Go 团队较低 | 需要 Rust 和 Tauri 配置经验 |
| 开箱即用程度 | 中等，偏向开发者自行搭建 | 较高，偏向插件组装 |
| 长期技术统一性 | 对 Go 产品较好 | 对 Rust 产品较好 |

## 5. 对 Autoto 的具体影响

### 5.1 Autoto 不是一个普通的新建桌面项目

Autoto 已经是一个较完整的 Go 本地服务：

```text
cmd/autoto
  -> internal/app.Run
  -> HTTP API + WebSocket
  -> Agent / Provider / Tools
  -> SQLite
  -> Background / Preview / Terminal
  -> Embedded HTML/CSS/ES Modules
```

现有核心能力包括：

- Go HTTP 服务；
- 嵌入式前端资源；
- SQLite 数据和迁移；
- Agent 与 Tool 审批；
- WebSocket 事件；
- PTY 终端；
- 远程访问；
- Telegram 和 Home Assistant；
- Provider、MCP 和插件；
- 浏览器客户端。

所以 Autoto 的桌面框架选择不能只看“哪一个插件多”，还必须看：

- 是否复用现有 Go Runtime；
- 是否保留浏览器和远程客户端；
- 是否引入第二套业务接口；
- 是否需要管理第二个后端运行时；
- 是否破坏现有 HTTP/WebSocket 安全边界。

### 5.2 使用 Wails 的实际形态

Wails 对 Autoto 的合理用法应是“可选桌面壳”，而不是重写整个业务协议。

建议形态：

```text
Autoto Go Runtime
├── HTTP API
├── Agent WebSocket
├── Terminal WebSocket
├── SQLite
├── Provider / Tools
└── Runtime Supervisor

客户端
├── 普通浏览器
└── Wails 桌面窗口
```

优势：

- 可以直接复用 Go package；
- 有机会做成单进程或更紧密的生命周期；
- 不需要维护 Rust 后端；
- 桌面壳可以直接管理 Go Runtime。

缺点：

- Wails v3 仍处于 Alpha；
- 需要自己补齐部分产品级原生能力；
- 如果前端改用 Wails Binding，会与现有 HTTP API 形成两套调用路径；
- 仍需为浏览器模式保留原有接口。

因此，即使使用 Wails，也不建议把 Agent、Provider、Tools、审批、Git 等核心功能改成只允许 Wails Binding 调用。

### 5.3 使用 Tauri 的实际形态

Tauri 对 Autoto 最现实的方案是：

```text
Tauri Desktop Shell
  -> 启动 autoto Go sidecar
  -> 等待本机健康检查
  -> WebView 加载 Autoto UI
  -> 关闭窗口时停止 sidecar
```

优势：

- 原生 Dialog、Updater、Single Instance、Autostart、Window State 等功能更容易标准化接入；
- 桌面壳的产品化能力较完整；
- Capability/Permission 模型适合限制不同窗口的系统权限；
- 不需要重写现有前端页面。

缺点：

- 同时维护 Go 与 Rust；
- 需要处理 sidecar 启动、健康检查、异常退出和升级；
- 需要处理端口选择、本机认证和进程树回收；
- Tauri 更新器必须考虑桌面壳和 Go sidecar 的版本一致性；
- 如果前端直接调用 Rust Command，容易再形成一套业务接口；
- 构建、签名和排错涉及两个生态。

因此，Tauri 的“直接上手”主要体现在桌面插件，而不是 Autoto 核心业务可以直接迁入。

## 6. 本次评估的修正结论

此前只从“Autoto 已经是 Go 项目”出发，会自然认为 Wails 是最顺手的桌面壳。加入生态成熟度和产品级原生能力后，结论应调整为：

1. **那条评价有事实基础。** Tauri 2 在常见桌面功能的官方插件、权限声明和标准接入流程上，确实比 Wails v3 更开箱即用。
2. **Wails 不是没有原生能力。** “毛坯”指的是需要开发者自行补齐更多产品化封装，而不是能力缺失或界面质量差。
3. **Tauri 对 Autoto 也不是无成本的直接替换。** 现有 Go Runtime 仍需作为 sidecar 保留，或者把大量业务改写为 Rust；前者引入双运行时，后者代价更大。
4. **Autoto 不应该为了桌面框架而重写核心协议。** HTTP/WebSocket、Agent、Provider、Tools 和安全边界应继续保持唯一事实源。
5. **是否选择 Tauri，取决于桌面产品化优先级。** 如果近期目标是快速获得更新器、单实例、自启动、原生对话框和窗口状态等能力，Tauri 2 更有优势。
6. **是否选择 Wails，取决于单一 Go 技术栈的优先级。** 如果更重视单进程、Go package 复用和长期技术统一，并能接受自行补齐桌面功能以及 Wails v3 Alpha 风险，Wails 更自然。

## 7. 对 Autoto 的推荐决策

### 7.1 当前不急于发布桌面安装包

建议暂时不引入任何桌面框架，先完成框架无关的基础工作：

1. 从 `internal/app/run.go` 拆出可启动和可关闭的 Runtime；
2. 统一 Background、Preview、Terminal、MCP 的子进程生命周期；
3. Windows 使用 Job Object 或等价机制回收完整进程树；
4. 抽象前端 Dialog 接口，移除业务模块对 `window.confirm` 的直接依赖；
5. 保持 HTTP/WebSocket 为唯一核心业务协议；
6. 明确浏览器本地偏好与服务器权威数据的边界。

这些工作无论最后选 Wails 还是 Tauri 都能复用。

### 7.2 近期必须快速交付桌面版

建议优先验证：

```text
Tauri 2 壳 + 现有 autoto Go sidecar
```

原因是桌面产品通常很快会需要：

- 单实例；
- 原生文件和目录对话框；
- 窗口状态恢复；
- 系统托盘；
- 自启动；
- 应用更新；
- 通知和打开外部链接。

Tauri 2 对这些能力已有较标准的插件路径。

但验证必须坚持以下边界：

- Tauri 不实现 Agent 业务逻辑；
- Tauri 不复制 Provider、Tools 或审批规则；
- Go sidecar 保持服务端权威；
- Tauri 只负责桌面窗口、生命周期和系统集成；
- 桌面版与浏览器版使用同一套前端和 API；
- 桌面壳退出时必须可靠停止完整 Go 进程树；
- 更新必须保证壳与 sidecar 版本一致。

### 7.3 更重视单进程和 Go 技术统一

建议继续观察 Wails v3，或者做一个严格受限的概念验证：

- 只创建窗口；
- 只复用现有 Go Runtime；
- 不把核心 API 改成 Wails Binding；
- 只验证关闭、重启、崩溃恢复、对话框和打包；
- 不在概念验证阶段加入数据库迁移或大规模前端改造。

如果 Wails v3 的 Alpha 状态、工具链和缺失的桌面能力导致维护成本过高，可以保留实验分支而不进入主发布流程。

## 8. 推荐的选择矩阵

| 产品目标 | 推荐方向 |
|---|---|
| 继续以本地 Web 服务为主 | 暂不引入桌面框架 |
| 最快获得成熟桌面产品功能 | Tauri 2 + Go sidecar |
| 最大化复用 Go、减少语言数量 | Wails |
| 强调细粒度桌面权限配置 | Tauri 2 |
| 强调单进程和 Go Runtime 生命周期统一 | Wails |
| 同时保留浏览器和远程访问 | 两者都只能作为可选客户端，不能替代 HTTP/WebSocket 核心 |
| 团队没有 Rust 经验 | Wails 或暂缓桌面化 |
| 团队愿意维护 Rust 壳并重视官方插件 | Tauri 2 |

## 9. 概念验证的验收标准

无论选择哪一个框架，概念验证至少应覆盖：

1. 桌面窗口能可靠启动现有 Autoto；
2. 不出现固定端口冲突或复用错误实例；
3. 关闭窗口后没有残留 Go、Shell、Preview 或 MCP 进程；
4. 浏览器版仍能独立运行；
5. Agent WebSocket 和 Terminal WebSocket 正常；
6. 本地 token、Origin、Cookie 和远程访问边界不被削弱；
7. 原生目录选择在 Windows、macOS、Linux 行为一致；
8. 应用单实例策略明确；
9. 桌面壳与 Go Runtime 版本不匹配时拒绝启动或明确报错；
10. 更新失败时可恢复到上一完整版本；
11. 打包产物不包含开发凭据或本地数据库；
12. 至少完成 Windows 和 macOS 的真实安装、启动、退出和升级测试。

## 10. 最终总结

“Wails 原生比较毛坯，Tauri 可以直接上手”可以翻译为：

> Wails 更像给 Go 开发者提供桌面窗口和系统能力的基础框架，很多产品级功能需要自己封装；Tauri 2 则通过较完整的官方插件和权限体系，把常见桌面需求整理成了更标准的安装与调用流程。

这句话对一般新项目有一定准确性，但对 Autoto 不能直接推导出“Tauri 一定更省事”。Autoto 已经拥有庞大的 Go Runtime，使用 Tauri 意味着维护 Rust 桌面壳与 Go sidecar；使用 Wails 则意味着承担 v3 Alpha 和更多原生产品化封装。

本次建议是：

- 不重写 Autoto 核心；
- HTTP/WebSocket 继续作为唯一业务协议；
- 先完成 Runtime 生命周期、跨平台进程树回收和 Dialog 抽象；
- 如果近期必须交付桌面版，优先做 Tauri 2 + Go sidecar 的受限概念验证；
- 如果更重视单一 Go 技术栈和单进程维护，再评估 Wails；
- 桌面框架最终应是 Autoto 的客户端外壳，而不是新的业务后端。

## 11. 核对依据

本次结论依据以下官方资料核对：

- Wails v3 官方首页、Quick Start 与 API/功能说明；
- Tauri 2 官方插件目录；
- Tauri 2 Capability/Permission 文档；
- Tauri 2 Dialog 插件文档；
- Autoto 当前 `cmd/autoto`、`internal/app`、`internal/server`、`internal/background`、`internal/preview`、`internal/db` 和嵌入式前端实现。
