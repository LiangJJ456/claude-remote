# Claude Remote 会话宿主

托管 Claude Code 会话，让电脑终端 / 浏览器 / 手机 app 随时附身操作。
设计文档见 `../docs/superpowers/specs/2026-06-12-claude-remote-app-design.md`。

## 启动

    cd host
    npm install
    npm start            # 前台运行
    .\register-autostart.ps1   # 注册开机自启（守护循环，崩溃自动重启）

首次启动会生成 `data/config.json`（端口、token、claude 命令路径，可改）。

**Windows 注意**：`claudeCommand` 默认值 `claude` 无法被 ConPTY 直接启动（claude 在 PATH 里通常是 .ps1/.cmd 包装）。请把 `data/config.json` 的 `claudeCommand` 改为 claude 的 .exe 完整路径，例如：
`C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
（用 `(Get-Command claude).Source` 找到 claude 安装位置后定位同目录或 node_modules 下的 claude.exe。）

## macOS / Linux

宿主跨平台，Mac/Linux 上直接：

    cd host
    npm install
    npm start

`@lydell/node-pty` 自带 darwin-x64 / darwin-arm64 / linux 预编译二进制，免编译。
Mac/Linux 上 `claude` 通常是 PATH 里的真实可执行文件，`claudeCommand` 默认值 `claude`
一般可直接用；若提示找不到，把 `data/config.json` 的 `claudeCommand` 改成 `which claude`
的完整路径（如 `/opt/homebrew/bin/claude` 或 `~/.claude/local/claude`）。

开机自启：Windows 用 `register-autostart.ps1`；Mac 用 launchd（写个 LaunchAgent plist 跑
`node src/index.js`）；Linux 用 systemd user service。`cc` 终端命令目前只有 .ps1 版（Windows）；
Mac/Linux 用手机 app 连接即可，无需 cc。

连接步骤同 Windows：装 Tailscale 登同一账号 → `npm start` → 记下打印的 token →
手机 app「管理电脑」→「+」填 `ws://<这台的 Tailscale IP>:8787` + token。

## 使用

- 电脑浏览器 / 手机（连 Tailscale）：打开 `http://<IP>:8787`，输入 token
- 终端：`bin\cc.ps1`（建议加 PATH 或设别名）在当前目录新建会话；Ctrl+Q 离开（会话不死）
- Hook 接入：见 `~/.claude/settings.json` 的 Stop / Notification hooks，
  只在存在 CC_HOST_SESSION_ID 环境变量（即宿主托管的会话）时上报

## 测试

    npm test

## 安全

- 只监听 127.0.0.1 和 Tailscale 网卡（100.64.0.0/10），绝不监听 0.0.0.0
- /hook 端点只接受 loopback 来源
- WebSocket 需 token 鉴权（data/config.json）
