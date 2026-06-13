# Claude Remote

手机远程接管电脑上的 Claude Code 会话。电脑跑一个会话宿主，手机经 [Tailscale](https://tailscale.com/) 随时随地连上，查看进度、继续对话、批准权限、收推送通知——就像把电脑上的 Claude Code 装进了口袋。

## 它能做什么

- 📱 安卓 app 列出电脑上所有 Claude Code 会话，点开即接管
- 🖥️ 终端镜像：原样渲染 Claude Code 界面（ANSI 颜色、表格、吉祥物），可打字、滚动、捏合缩放
- 🔔 Claude 停下等输入 / 请求授权时，手机弹通知，点击直达对应会话
- 🔌 断线自动重连（指数退避）；退后台靠前台服务保活
- ⌨️ 底部快捷键栏（Esc / Tab / 方向键 / Ctrl+C 等软键盘敲不出的控制键）
- 📁 新建会话时浏览/筛选电脑目录、切换磁盘
- 💻 同时连接多台电脑，在它们的会话之间切换

## 架构

```
                Tailscale 虚拟局域网（WireGuard 加密）
  ┌──────────┐                        ┌─────────────────────────────┐
  │ 安卓 App │ ←—— WebSocket ————————→│  会话宿主（Node.js, 常驻）    │
  └──────────┘                        │  ┌─────────┐ ┌─────────┐     │
  ┌──────────┐                        │  │ConPTY #1│ │ConPTY #2│ …   │
  │ 电脑浏览器│ ←—— WebSocket ————————→│  │ claude  │ │ claude  │     │
  └──────────┘                        │  └─────────┘ └─────────┘     │
  ┌────────────────┐  HTTP /hook      │   每会话一个伪终端，宿主持有  │
  │ Claude Hooks   │ ————————————————→│   画面缓冲与状态机           │
  └────────────────┘                  └─────────────────────────────┘
```

会话的"真身"住在宿主进程里，不属于任何终端窗口——电脑终端、浏览器、手机都是平等的"观众+遥控器"，随连随走、会话不死。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `host/` | 会话宿主（Node.js + node-pty + ws）。见 [host/README.md](host/README.md) |
| `app/` | 安卓 app（Kotlin + Jetpack Compose）。构建见 [app/README.md](app/README.md) |
| `docs/superpowers/specs/` | 设计文档 |
| `docs/superpowers/plans/` | 实施计划 |

## 快速开始

1. **电脑端**：`cd host && npm install && npm start`（生成 `data/config.json`，打印 token）。详见 [host/README.md](host/README.md)。
2. **组网**：电脑和手机都装 Tailscale、登同一账号。
3. **手机端**：装 app（[构建说明](app/README.md)），「管理电脑」→「+」填 `ws://<电脑的 Tailscale IP>:8787` + token。

宿主跨平台：Windows / macOS / Linux 均可（Mac/Linux 说明见 host/README.md）。

## 安全

- 宿主只监听 `127.0.0.1` 和 Tailscale 网卡（`100.64.0.0/10`），**绝不监听 `0.0.0.0`**
- WebSocket 需 token 鉴权；`/hook` 端点只接受本机来源
- 传输加密由 Tailscale（WireGuard）负责
- `data/config.json`（含 token）已 gitignore，不入库

## 技术栈

- 宿主：Node.js 20+、`@lydell/node-pty`（免 NDK 预编译）、`ws`
- app：Kotlin、Jetpack Compose、OkHttp、kotlinx-serialization、DataStore，终端渲染 vendored 自 [Termux](https://github.com/termux/termux-app)（Apache-2.0）
