# Claude Remote — 安卓 App

Kotlin + Jetpack Compose。经 Tailscale 连接[会话宿主](../host/README.md)，接管电脑上的 Claude Code 会话。

## 前置环境

- **JDK 17**（Android Gradle Plugin 要求 17；JDK 25 等过新版本不被支持）
- **Android SDK**：`platform-tools`（含 adb）、`platforms;android-35`、`build-tools;35.0.0`
  - 只装命令行工具即可，无需 Android Studio：下载 [commandline-tools](https://developer.android.com/studio#command-line-tools-only)，
    放到 `<SDK>/cmdline-tools/latest/`，再 `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` 并接受许可。
- **无需 NDK**：终端模块 vendored 自 Termux 但已去除原生 JNI（见 `terminal-emulator/VENDORED.md`）。

不需要联网下载的版本：Gradle 8.9（首次构建自动下载）、AGP 8.7.3、Kotlin 2.0.21、compileSdk 35 / minSdk 26。

## 配置 SDK 路径

在 `app/`（本目录）创建 `local.properties`（已 gitignore，不入库）：

```properties
sdk.dir=D:\\Android\\Sdk        # 改成你的 Android SDK 路径；macOS 如 /Users/you/Library/Android/sdk
```

## 构建

```bash
# Windows PowerShell：先设 JAVA_HOME 指向 JDK 17
$env:JAVA_HOME='D:\Java\jdk17\jdk-17.0.19+10'
cd app
.\gradlew.bat :app:assembleDebug
# macOS/Linux：
# export JAVA_HOME=/path/to/jdk-17 ; cd app ; ./gradlew :app:assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`

## 单元测试

```bash
.\gradlew.bat :app:testDebugUnitTest      # 协议/客户端/仓库/编解码，纯逻辑
```

## 安装到手机

### 无线 adb（推荐，免数据线）

手机与电脑同一 Wi-Fi。手机：设置 → 关于手机 → 连点 7 次「版本号」开开发者选项 → 开发者选项 → 「无线调试」→「使用配对码配对设备」。

```bash
# 配对（用弹窗里的「配对码」和「IP:配对端口」）
adb pair <手机IP>:<配对端口> <6位配对码>
# 连接（用无线调试主页面的「IP:连接端口」，与配对端口不同；或 adb 会经 mDNS 自动发现）
adb connect <手机IP>:<连接端口>
adb devices                                  # 应显示为 device
# 安装
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> 手机重启或换 Wi-Fi 后需重新 `adb pair` + `adb connect`。

### USB

开启 USB 调试，连线后直接 `adb install -r ...`。

## 模块

| 模块 | 说明 |
|---|---|
| `:app` | 主应用（UI、网络、前台服务） |
| `:terminal-emulator` / `:terminal-view` | vendored 自 [Termux](https://github.com/termux/termux-app)（Apache-2.0），已去 native、加"远程模式"由 WebSocket 字节驱动 |

协议与宿主对齐，定义见 `host/src/server.js`。app 侧在 `app/src/main/java/com/claude/remote/net/Protocol.kt`。
