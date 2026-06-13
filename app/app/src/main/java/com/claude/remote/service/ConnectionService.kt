package com.claude.remote.service

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.claude.remote.data.SessionRepository
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 前台服务：持有到宿主的 WebSocket 长连接，使 app 退后台仍保持连接并能弹通知。
 * Activity 绑定本服务获取会话流/连接状态/下行流，并经此发送消息。
 */
class ConnectionService : Service() {

    inner class LocalBinder : Binder() { fun service(): ConnectionService = this@ConnectionService }

    private val binder = LocalBinder()
    private val main = Handler(Looper.getMainLooper())

    val repo = SessionRepository()
    val incoming = MutableSharedFlow<HostMsg>(extraBufferCapacity = 512)
    val connState = MutableStateFlow(ConnState.DISCONNECTED)

    private var client: HostClient? = null
    private var started = false

    // 自动重连状态
    private var url: String? = null
    private var token: String? = null
    private var wantConnected = false
    private var reconnectAttempt = 0
    private val reconnectRunnable = Runnable {
        val u = url; val t = token
        if (wantConnected && u != null && t != null) connect(u, t)
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    /** 幂等启动前台 + 连接。Activity 拿到 config 后调用。 */
    fun start(url: String, token: String) {
        this.url = url; this.token = token; this.wantConnected = true
        if (!started) {
            startForegroundCompat("正在连接 $url")
            started = true
        }
        reconnectAttempt = 0
        connect(url, token)
    }

    /** 断线后按指数退避安排重连（1,2,4,8,16,封顶 30 秒）。 */
    private fun scheduleReconnect() {
        if (!wantConnected) return
        main.removeCallbacks(reconnectRunnable)
        val delay = minOf(30_000L, 1000L * (1L shl minOf(reconnectAttempt, 5)))
        reconnectAttempt++
        updateOngoing("已断开，${delay / 1000}s 后重连…")
        main.postDelayed(reconnectRunnable, delay)
    }

    private fun startForegroundCompat(text: String) {
        val n = Notifications.ongoing(this, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                Notifications.ONGOING_ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(Notifications.ONGOING_ID, n)
        }
    }

    private fun updateOngoing(text: String) {
        androidx.core.app.NotificationManagerCompat.from(this)
            .notify(Notifications.ONGOING_ID, Notifications.ongoing(this, text))
    }

    fun send(msg: ClientMsg) = client?.send(msg)

    private fun connect(url: String, token: String) {
        client?.close()
        client = HostClient(
            url = url, token = token,
            onMessage = { msg ->
                main.post {
                    repo.onHostMsg(msg)
                    incoming.tryEmit(msg)
                    when (msg) {
                        is HostMsg.AuthOk -> client?.send(ClientMsg.ListSessions)
                        is HostMsg.Created -> client?.send(ClientMsg.ListSessions)
                        is HostMsg.Event -> onEvent(msg)
                        else -> {}
                    }
                }
            },
            onState = { st ->
                main.post {
                    connState.value = st
                    when (st) {
                        ConnState.CONNECTED -> { reconnectAttempt = 0; updateOngoing("已连接") }
                        ConnState.CONNECTING -> updateOngoing("连接中…")
                        ConnState.DISCONNECTED -> scheduleReconnect() // 真断线 → 自动重连
                    }
                }
            },
        )
        client!!.connect()
    }

    /** 会话事件 → 本地通知。会话名取自当前列表，缺省用 id 前 6 位。 */
    private fun onEvent(ev: HostMsg.Event) {
        val name = repo.sessions.value.firstOrNull { it.id == ev.sessionId }?.name
            ?: ev.sessionId.take(6)
        when (ev.kind) {
            "stop" -> Notifications.event(this, ev.sessionId, "会话等待输入", "「$name」已停下，点开继续")
            "permission_request" -> Notifications.event(this, ev.sessionId, "请求授权", "「$name」需要你批准操作")
            else -> {}
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        wantConnected = false
        main.removeCallbacks(reconnectRunnable)
        client?.close()
    }
}
