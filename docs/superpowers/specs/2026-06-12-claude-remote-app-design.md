# Claude Remote：手机远程接管电脑上的 Claude Code 会话

日期：2026-06-12
状态：设计已获用户批准

## 1. 目标

做一个安卓原生 app，让用户随时随地通过手机连接自己的 Windows 电脑，接管电脑上正在运行的 Claude Code 终端会话：查看进度、继续对话、批准权限，并在 Claude 停下来等输入或需要批准时收到手机通知。

这是一个开发实践项目（用户明确选择自建而非使用 Claude Code 自带的 Remote Control）。

## 2. 已确认的需求与决策

| 维度 | 决策 |
|---|---|
| 项目性质 | 自己开发（学习/实践），不用现成方案 |
| 手机端 | 安卓原生 app，Kotlin + Jetpack Compose |
| 网络 | 必须随时随地可用；用 Tailscale 组网，app 直连电脑的虚拟局域网 IP |
| 核心能力 | 接管电脑上已有的 Claude Code 终端会话（非仅发起新任务） |
| 会话宿主 | 自建 Node.js 宿主服务（ConPTY/node-pty），不迁移到 WSL+tmux |
| 启动方式约定 | 以后用 `cc` 封装命令代替 `claude` 启动会话（接受此前提） |
| App 界面 | 终端镜像 + 手机优化快捷键栏（不做聊天气泡式解析 UI） |
| 手机通知 | 核心功能；本地通知（前台服务长连接触发），不依赖 Google FCM |
| 终端渲染 | 复用 Termux 开源 terminal-view 库（Apache 2.0），不自研 ANSI 渲染 |

## 3. 总体架构

```
                    Tailscale 虚拟局域网（WireGuard 自动加密）
  ┌──────────┐                          ┌─────────────────────────────┐
  │ 安卓 App │ ←—— WebSocket ——————————→│  会话宿主服务（Node.js）      │
  └──────────┘                          │  Windows 电脑，常驻后台       │
  ┌──────────┐                          │                             │
  │ 电脑浏览器│ ←—— WebSocket ——————————→│  ┌─────────┐  ┌─────────┐   │
  │ (测试/日常)│                         │  │ConPTY #1│  │ConPTY #2│…  │
  └──────────┘                          │  │ claude  │  │ claude  │   │
                                        │  └─────────┘  └─────────┘   │
  ┌────────────────┐   HTTP POST        │       ↑                     │
  │ Claude Code    │ ——————————————————→│   每个会话一个伪终端，        │
  │ Hooks(Stop等)  │   (事件上报)        │   宿主持有画面和回滚缓冲      │
  └────────────────┘                    └─────────────────────────────┘
```

核心思想：会话的"真身"住在宿主进程里，不属于任何终端窗口。电脑终端、电脑浏览器、手机 app 都是平等的"观众+遥控器"，随连随走、会话不死。

## 4. 组件与职责

### 4.1 会话宿主（Node.js + node-pty + ws）—— 子项目一主体

- 会话管理：创建（在指定 cwd 用 ConPTY 拉起 `claude`）、列表、附身/离开、终止
- 每会话维护回滚缓冲（环形缓冲，默认上限 1 MB 原始输出，可配置）；客户端附身时先回放缓冲，再接实时流
- 多客户端可同时附身同一会话：输出广播，输入均可
- 内置极简网页客户端（xterm.js）：开发期测试工具 + 日常电脑端入口
- 接收 Claude Code Hook 的 HTTP 事件上报，匹配到会话，广播给订阅客户端
- 会话状态机：working / waiting / exited，由 Hook 事件驱动（Stop→waiting，新输入→working），不解析终端画面

### 4.2 启动命令 `cc`（PowerShell 脚本）

- 请求宿主创建会话，然后将当前终端窗口作为客户端附身上去
- 用户体验与直接运行 `claude` 几乎一致

### 4.3 Hook 集成（`~/.claude/settings.json`）

- Stop / Notification / PermissionRequest 事件 HTTP POST 给宿主
- 与用户已有的 Windows 桌面通知 hook 并存
- 事件需携带会话标识：宿主拉起 claude 时在 PTY 环境中注入 `CC_HOST_SESSION_ID` 环境变量，hook 进程继承该变量并随事件上报，宿主据此映射到托管会话

### 4.4 安卓 App（Kotlin + Jetpack Compose）—— 子项目二

- 会话列表页：展示每个会话的状态（干活中/等输入/已结束）
- 终端页：Termux terminal-view 原生渲染 ANSI；底部快捷键栏（回车 / ESC / ↑↓ / 数字选项 / 打断）
- 前台服务维持 WebSocket 长连接；收到 stop / permission_request 事件弹本地通知，点击直达对应会话
- 设置页：宿主地址（Tailscale IP:端口）、token

## 5. 通信协议（WebSocket，JSON 消息）

所有客户端（网页、安卓）使用同一协议。消息结构 `{type, ...}`。

### 客户端 → 宿主

| 消息 | 作用 |
|---|---|
| `auth {token}` | 连接后第一条消息，token 错误即断开 |
| `list` | 拉取会话列表 |
| `create {cwd, name}` | 新建 claude 会话 |
| `attach {sessionId, cols, rows}` | 附身：先回放缓冲，再实时流 |
| `input {sessionId, data}` | 发送按键/控制字符 |
| `resize {sessionId, cols, rows}` | 同步终端尺寸（转屏/键盘弹出） |
| `detach {sessionId}` | 离开会话 |
| `kill {sessionId}` | 终止会话 |

### 宿主 → 客户端

| 消息 | 作用 |
|---|---|
| `sessions [{id, name, cwd, state, createdAt}]` | 会话列表；state ∈ working / waiting / exited |
| `output {sessionId, data}` | 终端输出（base64），回放与实时同格式 |
| `event {sessionId, kind}` | kind ∈ stop / permission_request / session_exited |
| `error {message}` | 错误说明 |

## 6. 安全

- 网络层：宿主只监听 Tailscale 虚拟网卡 IP（100.x.x.x）与 localhost；公网与普通局域网均不可达；传输加密由 Tailscale（WireGuard）负责，不自管 TLS
- 应用层：长随机 token，宿主首次启动生成并存配置文件；app 设置页填写一次；防 tailnet 内其他设备误连
- 红线：此服务等价于"远程电脑的遥控器"，绝不监听 0.0.0.0

## 7. 错误处理

| 场景 | 对策 |
|---|---|
| 手机断网/Wi-Fi↔流量切换 | 前台服务指数退避重连；重连后重新 attach + 缓冲回放 |
| 宿主进程崩溃 | 会话随宿主死（ConPTY 固有限制，tmux 同理）。宿主以 Windows 服务方式自动重启；会话列表落盘，重启后提示哪些会话中断；可用 `claude --resume` 恢复对话上下文 |
| claude 进程退出 | 标记 exited，保留最后画面供查看，不立即销毁 |
| app 被系统杀死 | 收不到通知（无 FCM 的代价）；对策：前台服务 + 引导关闭电池优化 |

## 8. 测试与里程碑

### 子项目一：会话宿主（Node.js）

- 单元测试：会话管理器、回滚缓冲、token 鉴权（Node 内置 test runner）
- 集成测试：以普通 PowerShell 进程代替 claude，跑通协议全流程（创建→附身→输入→输出→离开）
- M1：网页客户端可完整操作一个 claude 会话
- M2：`cc` 命令可用
- M3：Hook 事件推送到网页端 —— 此时手机浏览器（连 Tailscale）已可先用

### 子项目二：安卓 App（Kotlin + Compose）

- M4：连接宿主、显示会话列表
- M5：终端页可看可输入
- M6：前台服务 + 本地通知
- M7：快捷键栏与体验打磨
- 测试：协议层单元测试 + 真机手动验收（重点：断线重连、转屏、后台通知）

## 9. 实施顺序

子项目一完成（M1–M3）并稳定后，再启动子项目二（M4–M7）。每个子项目各自走"实施计划 → 开发 → 验收"流程。
