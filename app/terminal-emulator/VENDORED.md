# Vendored from Termux

`terminal-emulator` 和 `terminal-view` 两个模块 vendored 自 [termux/termux-app](https://github.com/termux/termux-app)（Apache License 2.0，见 LICENSE.md）。

本项目（Claude Remote）的改动：
- **移除 native/JNI 构建**：删除 `src/main/jni/`，从 `build.gradle` 去掉 `externalNativeBuild`/`ndk` 配置——本 app 不 spawn 本地 PTY 子进程，无需 NDK。
- **`JNI.java` 改为 stub**：原生方法替换为抛异常/no-op 占位（仅 TerminalSession 的本地进程路径会调它们，远程模式不走该路径）。
- **`TerminalSession` 增加"远程模式"**（见该文件内 Claude Remote 标注）：跳过进程创建，改由 WebSocket 字节流驱动 emulator，用户输入转发到回调而非本地 pty。
- `build.gradle` 简化为本工程的 compileSdk/minSdk，去掉 maven-publish。
