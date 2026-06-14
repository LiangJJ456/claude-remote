package com.claude.remote.service

import android.os.Handler
import com.claude.remote.data.HostEntry
import com.claude.remote.data.SessionRepository
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 单台电脑（host）的连接单元：持 WebSocket、会话仓库、下行流、连接状态，并自带指数退避重连。
 * 由 ConnectionService 为每台已配置电脑创建一个实例。
 */
class HostConnection(
    val entry: HostEntry,
    private val main: Handler,
    private val onEvent: (HostConnection, HostMsg.Event) -> Unit,
    private val onStateChanged: () -> Unit,
) {
    val repo = SessionRepository()
    val incoming = MutableSharedFlow<HostMsg>(extraBufferCapacity = 512)
    val connState = MutableStateFlow(ConnState.DISCONNECTED)

    private var client: HostClient? = null
    private var wantConnected = false
    private var reconnectAttempt = 0
    private val reconnectRunnable = Runnable { if (wantConnected) connect() }

    fun start() {
        wantConnected = true
        reconnectAttempt = 0
        connect()
    }

    fun stop() {
        wantConnected = false
        main.removeCallbacks(reconnectRunnable)
        client?.close()
    }

    fun send(msg: ClientMsg) = client?.send(msg)

    private fun connect() {
        client?.close()
        client = HostClient(
            url = entry.url, token = entry.token,
            onMessage = { msg ->
                main.post {
                    repo.onHostMsg(msg)
                    incoming.tryEmit(msg)
                    when (msg) {
                        is HostMsg.AuthOk -> client?.send(ClientMsg.ListSessions)
                        is HostMsg.Created -> client?.send(ClientMsg.ListSessions)
                        is HostMsg.Event -> onEvent(this, msg)
                        is HostMsg.Sessions -> onStateChanged() // 会话列表变化 → 刷新通知/小组件
                        else -> {}
                    }
                }
            },
            onState = { st ->
                main.post {
                    connState.value = st
                    when (st) {
                        ConnState.CONNECTED -> reconnectAttempt = 0
                        ConnState.DISCONNECTED -> scheduleReconnect()
                        else -> {}
                    }
                    onStateChanged()
                }
            },
        )
        client!!.connect()
    }

    private fun scheduleReconnect() {
        if (!wantConnected) return
        main.removeCallbacks(reconnectRunnable)
        val delay = minOf(30_000L, 1000L * (1L shl minOf(reconnectAttempt, 5)))
        reconnectAttempt++
        main.postDelayed(reconnectRunnable, delay)
    }
}
