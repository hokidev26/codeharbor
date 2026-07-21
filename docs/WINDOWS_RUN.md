# 在 Windows 上运行 Autoto（本机独立实例）

这是 **Windows 自己的一套 Autoto**，数据在 Windows 用户目录，**不会**自动同步 Mac 上的项目。

## 1. 准备文件

从本仓库 `dist/` 拷贝对应架构的可执行文件到 Windows，例如：

| 电脑架构 | 文件 |
|----------|------|
| 普通 x64（大多数 Intel/AMD 笔记本） | `autoto-windows-amd64.exe` |
| ARM 版 Windows（部分 Surface） | `autoto-windows-arm64.exe` |

建议放到例如：

```text
C:\Users\<你的用户名>\autoto\autoto.exe
```

（把 `autoto-windows-amd64.exe` 重命名为 `autoto.exe` 即可。）

## 2. 启动

在 PowerShell 或「命令提示符」中：

```bat
cd C:\Users\<你的用户名>\autoto
.\autoto.exe
```

看到类似 `autoto listening` 后，用浏览器打开：

```text
http://127.0.0.1:16888
```

## 3. 默认数据位置（Windows）

与 Mac 类似，落在用户主目录下：

```text
%USERPROFILE%\.autoto\config.json
%USERPROFILE%\.autoto\autoto.db
```

首次运行会自动创建配置与数据库。

## 4. 配置模型 API

1. 打开 http://127.0.0.1:16888  
2. 进入 **设置 → 模型 / 提供商**  
3. 填入你自己的 API Key 与 Base URL  

Mac 上的 Key **不会**自动过来，需要在 Windows 上重新配置（或自行导出配置文件再拷贝）。

## 5. 后台常驻（可选）

- 保持一个 PowerShell 窗口运行 `.\autoto.exe`  
- 或用「任务计划程序」登录时启动该 exe  
- 关闭窗口即停止服务（除非你做成 Windows 服务，本 MVP 默认不做）

## 6. 注意

- 需要 **Windows 10/11**；本文件提供的是 **CLI 服务 + 浏览器 UI**，不是安装版 `.msi`。  
- 桌面壳（独立窗口）尚未提供成熟 Windows 安装包。  
- 若 SmartScreen 拦截未签名 exe：更多信息 → 仍要运行（仅在你信任该文件来源时）。  
- 防火墙若询问，允许专用网络即可（本机访问一般不需要公网放行）。

## 7. 停止

在运行 Autoto 的终端按 `Ctrl+C`。
