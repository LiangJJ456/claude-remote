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
`node src/index.js`）；Linux 用 systemd user service。`cc` 终端命令 Windows 用 `bin/cc.ps1`、
Mac/Linux 用 `bin/cc.sh`，宿主启动时会自动把 `cc` 登记进当前 shell 的启动文件（见下）。

连接步骤同 Windows：装 Tailscale 登同一账号 → `npm start` → 记下打印的 token →
手机 app「管理电脑」→「+」填 `ws://<这台的 Tailscale IP>:8787` + token。

## 使用

- 电脑浏览器 / 手机（连 Tailscale）：打开 `http://<IP>:8787`，输入 token
- 终端：敲 `cc` 在当前目录新建宿主托管会话；Ctrl+Q 离开（会话不死，手机/网页可接管）。
  宿主启动时会幂等地把 `cc` 函数写进当前 shell 的启动文件（Windows→PowerShell `$PROFILE`；
  zsh→`~/.zshrc`；bash→`~/.bashrc`（mac 为 `~/.bash_profile`）；fish→`~/.config/fish/config.fish`），
  只动一对 `# >>> claude-remote cc (auto)` 标记包起来的块。**新开终端**才生效（shell 规矩）。
  想手动注册一次：`node scripts/register-cc.js`。也可直接跑 `bin/cc.ps1` / `bin/cc.sh`。
- Hook 接入：在 `~/.claude/settings.json` 配 Stop / Notification hooks，
  只在存在 CC_HOST_SESSION_ID 环境变量（即宿主托管的会话）时上报。
  Windows 的 Stop hook 直接调用 `host/hooks/stop-report.ps1`（去 async 确保 stdin
  送达、纯 ASCII 避免 PS 5.1 按 GBK 误读、正则抠 session_id 而不用易出错的
  ConvertFrom-Json）；它把停下事件 + Claude 的 session_id 报给宿主，宿主据此读出
  **该会话自己的**最后一条回复，作为手机通知的预览内容。
- 通知预览要能读到回复，前提是 spawn 的 claude 真的落地了 transcript 文件——宿主
  spawn 时会剥掉继承自父进程的 `CLAUDE_CODE_*` / `CLAUDECODE` 等嵌套标记，
  确保 claude 当作全新顶层会话运行（否则它会以子会话模式跑、不写 transcript）。

## 测试

    npm test

## 安全

- 只监听 127.0.0.1 和 Tailscale 网卡（100.64.0.0/10），绝不监听 0.0.0.0
- /hook 端点只接受 loopback 来源
- WebSocket 需 token 鉴权（data/config.json）
