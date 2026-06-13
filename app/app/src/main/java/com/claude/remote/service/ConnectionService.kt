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

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    /** 幂等启动前台 + 连接。Activity 拿到 config 后调用。 */
    fun start(url: String, token: String) {
        if (!started) {
            startForegroundCompat("正在连接 $url")
            started = true
        }
        connect(url, token)
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
                    updateOngoing(
                        when (st) {
                            ConnState.CONNECTED -> "已连接"
                            ConnState.CONNECTING -> "连接中…"
                            ConnState.DISCONNECTED -> "已断开"
                        }
                    )
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
        client?.close()
    }
}
