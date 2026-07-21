# Autoto 桌面打包与签名（边界说明）

> 配套：`docs/DESKTOP_FRAMEWORK_WAILS_TAURI_ASSESSMENT.md` §12.2  
> 原则：**CLI 浏览器远程路径永远可用**；桌面壳是可选客户端。

## 1. 开发入口（日常）

```bash
# CLI + 手机隧道（推荐作为常驻服务）
make build-cli && ./autoto

# 本机原生窗口（默认 ephemeral 端口，不抢 CLI）
make build-desktop && ./autoto-desktop
```

`go build -tags desktop` 需要本机 WebView / Wails 依赖。Linux CI 默认 **不** 链 Wails（`//go:build desktop`）。

## 2. 正式安装包（本仓库边界）

| 产物 | 状态 | 说明 |
|---|---|---|
| 裸二进制 `autoto-desktop` | 支持 | 开发与内测 |
| macOS `.app` / 公证 | 未产品化 | 需 Apple Developer + notarize CI |
| Windows `.msi` / Authenticode | 未产品化 | 需证书与独立 release job |
| Linux AppImage/deb | 未产品化 | 可选后续 |

Wails v3 官方打包仍为 Alpha。正式签名流水线应在 **release CI** 完成，**不要**在运行时自签名。

建议独立任务（不在壳进程内）：

1. 构建带版本 ldflags 的 `autoto` + `autoto-desktop`
2. 生成 checksums（SHA-256）
3. 平台签名 / 公证
4. 发布 **惰性** update manifest（`internal/update` 仅元数据，无 URL/脚本字段）
5. 用户在 **本机** 下载后，用壳 API `POST /api/desktop/update/stage` 暂存；**远程不可 stage/apply**

## 3. 更新骨架（已实现边界）

- `GET /api/update/status`：只读计划元数据（远程可读，不可装）
- `POST /api/desktop/update/stage`：**loopback + 桌面 host**，复制本地文件到 `$HOME/updates/staged/`
- `GET/DELETE /api/desktop/update/pending`：查看/取消暂存
- **无**静默下载、**无**请求路径内替换正在运行的二进制、**无**远程触发安装

## 4. 深度链接与自启动（壳级）

- 自启动：托盘菜单 Enable/Disable Login Item；或 loopback  
  `GET|POST|DELETE /api/desktop/autostart`
- 深度链接：`autoto://agent?id=…`、`autoto://project?id=…`、`autoto://settings?panel=…`  
  注册 OS URL scheme 需要打包进 `.app` / 安装器；开发期可用 argv：  
  `./autoto-desktop 'autoto://settings?panel=remote-access'`

## 5. 手机远程不受影响

- 常驻请用 `./autoto` + 临时/命名 Cloudflare 隧道  
- 桌面 7–9 API 全部要求 **非远程 + loopback**；手机会话继续用既有 `/api/*` 与 Agent WebSocket  
- 关闭桌面窗只关 **该进程** Runtime（且 desktop 默认 ephemeral）；**不要**把手机会话挂在 desktop 临时进程上  
