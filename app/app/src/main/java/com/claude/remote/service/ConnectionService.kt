package com.claude.remote.service

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.claude.remote.data.HostEntry
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 前台服务：为每台已配置电脑维护一个 [HostConnection]（同时连接所有），使 app 退后台仍保持连接并能弹通知。
 * Activity 绑定本服务，按 hostId 获取各电脑的会话流/连接状态/下行流并发送消息。
 */
class ConnectionService : Service() {

    inner class LocalBinder : Binder() { fun service(): ConnectionService = this@ConnectionService }

    private val binder = LocalBinder()
    private val main = Handler(Looper.getMainLooper())

    private val connections = LinkedHashMap<String, HostConnection>()
    /** 当前电脑列表（供 UI 观察增删）。 */
    val hosts = MutableStateFlow<List<HostEntry>>(emptyList())

    private var started = false

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    fun connection(hostId: String): HostConnection? = connections[hostId]

    /**
     * 同步电脑列表：新增的开连接，删除的断开，已存在的若 url/token 变了则重连。幂等。
     */
    fun setHosts(list: List<HostEntry>) {
        if (!started) {
            startForegroundCompat("正在连接…")
            started = true
        }
        val incomingIds = list.map { it.id }.toSet()
        // 移除已删除的
        connections.keys.filter { it !in incomingIds }.forEach { id ->
            connections.remove(id)?.stop()
        }
        // 新增或更新
        for (entry in list) {
            val existing = connections[entry.id]
            if (existing == null) {
                val conn = HostConnection(entry, main, ::onHostEvent, ::updateAggregateNotification)
                connections[entry.id] = conn
                conn.start()
            } else if (existing.entry.url != entry.url || existing.entry.token != entry.token) {
                existing.stop()
                val conn = HostConnection(entry, main, ::onHostEvent, ::updateAggregateNotification)
                connections[entry.id] = conn
                conn.start()
            }
        }
        hosts.value = list
        updateAggregateNotification()
    }

    fun send(hostId: String, msg: ClientMsg) = connections[hostId]?.send(msg)

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

    private fun updateAggregateNotification() {
        val total = connections.size
        val connected = connections.values.count { it.connState.value == ConnState.CONNECTED }
        androidx.core.app.NotificationManagerCompat.from(this)
            .notify(Notifications.ONGOING_ID, Notifications.ongoing(this, "$connected/$total 台已连接"))
    }

    /** 某台电脑的会话事件 → 本地通知（带电脑名、hostId、Claude 回复预览、快捷按钮）。 */
    private fun onHostEvent(conn: HostConnection, ev: HostMsg.Event) {
        val sessionName = conn.repo.sessions.value.firstOrNull { it.id == ev.sessionId }?.name
            ?: ev.sessionId.take(6)
        val head = "${conn.entry.name} · 「$sessionName」"
        when (ev.kind) {
            "stop" -> Notifications.event(
                this, conn.entry.id, ev.sessionId, "stop", "会话等待输入",
                if (ev.preview.isNotBlank()) "$head\n${ev.preview}" else "$head 已停下，点开继续",
            )
            "permission_request" -> Notifications.event(
                this, conn.entry.id, ev.sessionId, "permission_request", "请求授权",
                if (ev.preview.isNotBlank()) "$head\n${ev.preview}" else "$head 需要你批准操作",
            )
            else -> {}
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 通知快捷按钮 → 直接向对应会话发送输入（不打开 UI）
        if (intent?.action == Notifications.ACTION_SEND_INPUT) {
            val hostId = intent.getStringExtra(Notifications.EXTRA_HOST_ID)
            val sessionId = intent.getStringExtra(Notifications.EXTRA_SESSION_ID)
            val input = intent.getStringExtra(Notifications.EXTRA_INPUT)
            if (hostId != null && sessionId != null && input != null) {
                val bytes = input.toByteArray(Charsets.UTF_8)
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                connections[hostId]?.send(ClientMsg.Input(sessionId, b64))
                androidx.core.app.NotificationManagerCompat.from(this)
                    .cancel((hostId + sessionId).hashCode())
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        connections.values.forEach { it.stop() }
        connections.clear()
    }
}
