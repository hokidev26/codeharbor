# Autoto 桌面壳验收清单

分支：`feature/wails-desktop-shell-foundation`  
默认构建 **不含** Wails；桌面壳需 `-tags desktop`。

## 1. 工程化（无 GUI 机器 / CI）

```bash
# 默认：CLI + 业务 + 前端，不链接 Wails
./scripts/check.sh
# 或
make check

# 确认桌面包被默认排除
! go list ./cmd/autoto-desktop ./internal/desktop
go list -tags desktop ./cmd/autoto-desktop ./internal/desktop

# 有原生 WebView 工具链的机器上：
make check-desktop
# 或
AUTOTO_CHECK_DESKTOP=1 ./scripts/check.sh
make build-desktop
```

期望：

- [ ] `make check` 在 Linux CI / 无 WebKit 环境通过
- [ ] 无 `-tags desktop` 时 `go list` 列不出 desktop 包
- [ ] `go build ./cmd/autoto` 成功且体积明显小于 desktop 二进制

## 2. Headless 冒烟（任意平台）

```bash
go build -tags desktop -o autoto-desktop ./cmd/autoto-desktop
./autoto-desktop -headless -ready-timeout 15s
# 另开终端：curl -sS "$URL/api/health"  → 200 {"ok":true,...}
# Ctrl+C → 进程 exit 0，端口释放
```

期望：

- [ ] 日志含 `desktop runtime ready url=http://127.0.0.1:<port>`
- [ ] `/api/health` 返回 200
- [ ] headless **不**注册原生 dialog host：`POST /api/desktop/dialog/confirm` → 404
- [ ] SIGINT/SIGTERM 后端口不可再连

## 3. GUI 冒烟（macOS / Windows，本机）

```bash
make build-desktop
./autoto-desktop
```

期望：

- [ ] 原生窗口打开，加载本地 UI（非空白）
- [ ] 聊天/设置等 API 正常（同源 + local token）
- [ ] 危险操作弹出 **系统** confirm（非浏览器样式），取消不执行
- [ ] 关窗：窗口隐藏，进程仍在，托盘可见
- [ ] 托盘 **Show**：窗口恢复；**Quit**：进程退出且 HTTP 端口释放
- [ ] 再启动第二个实例：应聚焦已有窗口，不长期双开（single instance）
- [ ] 远程/隧道场景：桌面 dialog API 对非 loopback 保持拒绝（403）

## 4. 回归：浏览器与远程不被破坏

```bash
make build-cli
./autoto
# 浏览器打开配置的 host:port
```

期望：

- [ ] CLI 行为与引入桌面前一致
- [ ] 浏览器 confirm 仍可用（`platform.mjs` 默认路径）
- [ ] 远程访问密码/会话逻辑不变；桌面 dialog 端点对远程 403/不可用

## 5. 原生选目录 / 图标 / 窗口状态（中优先级）

```bash
make build-desktop && ./autoto-desktop
```

期望：

- [ ] 「选择资料夹」在桌面壳内弹出 **系统** 目录对话框（非仅内置 modal）
- [ ] Windows/Linux 桌面壳同样可用（不依赖 macOS AppleScript）
- [ ] 托盘图标为 Autoto 资源（非 Wails 默认占位）
- [ ] 调整窗口大小/位置后退出再开：几何大致恢复；最大化状态可恢复
- [ ] 状态文件：`$AUTOTO_HOME/desktop-window.json`（或配置 `paths.homeDir`）

API（仅 loopback + 桌面 host）：

- `POST /api/desktop/dialog/open-directory` → `{ path, canceled }`
- `POST /api/desktop/dialog/open-file` → `{ path, canceled }`
- 既有 `POST /api/fs/native-directory` 在注册 shell host 时走 Wails 选择器

## 6. 桌面 7–9（更新骨架 / 打包边界 / 自启动+深链）

```bash
make build-desktop && ./autoto-desktop
# 另开终端保持手机能力：
make build-cli && ./autoto   # + 设置里一键隧道
```

期望：

- [ ] 托盘可 Enable/Disable Login Item（或 loopback `POST/DELETE /api/desktop/autostart`）
- [ ] `./autoto-desktop 'autoto://settings?panel=remote-access'` 能聚焦并改 hash（深链）
- [ ] `POST /api/desktop/update/stage` 仅 localhost 可暂存本地二进制；远程 403
- [ ] `GET /api/update/status` 远程仍只读，不能安装
- [ ] 手机经隧道登录后仍可对话 / 审批（与桌面壳并行时推荐 CLI 常驻）

打包：`make release-desktop` → `dist/`；签名见 `docs/DESKTOP_PACKAGING.md`。

## 7. 刻意不在本清单验收

- 完整静默自动更新 UI、后台替换正在运行的二进制
- macOS 公证 / Windows Authenticode 生产流水线
- OS 级 `autoto://` 安装器注册（需正式 .app/.msi）
- 通用文件系统 Binding / Agent 绑定
