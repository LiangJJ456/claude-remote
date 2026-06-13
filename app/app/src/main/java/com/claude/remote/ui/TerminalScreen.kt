package com.claude.remote.ui

import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.HostMsg
import com.claude.remote.terminal.TerminalCodec
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filterIsInstance

private const val TAG = "ClaudeRemoteTerm"

/**
 * 终端页：AndroidView 嵌入 Termux TerminalView，附身远程会话。
 *
 * @param sessionId 要附身的宿主会话 id
 * @param incoming  宿主下行消息流（MainActivity 提供，含 output/event）
 * @param send      向宿主发送 ClientMsg
 * @param fontSizePx 终端字号（px）
 */
@Composable
fun TerminalScreen(
    sessionId: String,
    incoming: Flow<HostMsg>,
    send: (ClientMsg) -> Unit,
    fontSizePx: Int = 32,
) {
    // 用 holder 在 AndroidView factory 与 effect 之间共享 view/session 引用
    val holder = rememberTerminalHolder()

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val view = TerminalView(ctx, null)
                view.setTextSize(fontSizePx)

                // 用户输入 → 经 RemoteInput 回调 → 发往宿主
                val session = TerminalSession(
                    NoopSessionClient { holder.view?.onScreenUpdated() },
                ) { data, offset, count ->
                    send(TerminalCodec.encodeInput(sessionId, data, offset, count))
                }

                view.setTerminalViewClient(MinimalViewClient(fontSizePx) {
                    // onEmulatorSet：emulator 就绪后，把当前尺寸告诉宿主并附身（回放+实时流）
                    val emu = view.mEmulator
                    if (emu != null && !holder.attached) {
                        holder.attached = true
                        send(ClientMsg.Attach(sessionId, emu.mColumns, emu.mRows))
                    }
                })
                view.attachSession(session)

                holder.view = view
                holder.session = session
                view
            },
        )
    }

    // 收下行：本会话的 output 喂给 emulator
    LaunchedEffect(sessionId) {
        incoming.filterIsInstance<HostMsg.Output>().collect { out ->
            if (out.sessionId == sessionId) {
                val s = holder.session ?: return@collect
                val bytes = TerminalCodec.decodeOutput(out.dataB64)
                s.appendBytes(bytes, bytes.size)
            }
        }
    }

    // 离开：通知宿主 detach（会话仍在后台），结束本地会话对象
    DisposableEffect(sessionId) {
        onDispose {
            send(ClientMsg.Detach(sessionId))
            holder.session?.finishIfRunning()
        }
    }
}

private class TerminalHolder {
    var view: TerminalView? = null
    var session: TerminalSession? = null
    var attached: Boolean = false
}

@Composable
private fun rememberTerminalHolder(): TerminalHolder =
    androidx.compose.runtime.remember { TerminalHolder() }

/** TerminalSessionClient 最小实现：屏幕更新触发重绘，其余日志/忽略。 */
private class NoopSessionClient(val onScreenUpdate: () -> Unit) : TerminalSessionClient {
    override fun onTextChanged(changedSession: TerminalSession) { onScreenUpdate() }
    override fun onTitleChanged(changedSession: TerminalSession) {}
    override fun onSessionFinished(finishedSession: TerminalSession) {}
    override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {}
    override fun onPasteTextFromClipboard(session: TerminalSession?) {}
    override fun onBell(session: TerminalSession) {}
    override fun onColorsChanged(session: TerminalSession) {}
    override fun onTerminalCursorStateChange(state: Boolean) {}
    override fun setTerminalShellPid(session: TerminalSession, pid: Int) {}
    override fun getTerminalCursorStyle(): Int? = null
    override fun logError(tag: String?, message: String?) { Log.e(tag ?: TAG, message ?: "") }
    override fun logWarn(tag: String?, message: String?) { Log.w(tag ?: TAG, message ?: "") }
    override fun logInfo(tag: String?, message: String?) { Log.i(tag ?: TAG, message ?: "") }
    override fun logDebug(tag: String?, message: String?) { Log.d(tag ?: TAG, message ?: "") }
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) { Log.e(tag ?: TAG, message, e) }
    override fun logStackTrace(tag: String?, e: Exception?) { Log.e(tag ?: TAG, "", e) }
}

/** TerminalViewClient 最小实现：按键交给 view 默认处理（写入 session），无外部修饰键。 */
private class MinimalViewClient(
    val fontSizePx: Int,
    val onEmulatorReady: () -> Unit,
) : TerminalViewClient {
    override fun onScale(scale: Float): Float = fontSizePx.toFloat() // 禁用捏合缩放
    override fun onSingleTapUp(e: MotionEvent?) {}
    override fun shouldBackButtonBeMappedToEscape(): Boolean = false
    override fun shouldEnforceCharBasedInput(): Boolean = true
    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = true
    override fun copyModeChanged(copyMode: Boolean) {}
    override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean = false
    override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false
    override fun onLongPress(event: MotionEvent?): Boolean = false
    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean = false
    override fun onEmulatorSet() { onEmulatorReady() }
    override fun logError(tag: String?, message: String?) { Log.e(tag ?: TAG, message ?: "") }
    override fun logWarn(tag: String?, message: String?) { Log.w(tag ?: TAG, message ?: "") }
    override fun logInfo(tag: String?, message: String?) { Log.i(tag ?: TAG, message ?: "") }
    override fun logDebug(tag: String?, message: String?) { Log.d(tag ?: TAG, message ?: "") }
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) { Log.e(tag ?: TAG, message, e) }
    override fun logStackTrace(tag: String?, e: Exception?) { Log.e(tag ?: TAG, "", e) }
}
