package com.claude.remote

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.claude.remote.data.HostEntry
import com.claude.remote.data.Settings
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.service.ConnectionService
import com.claude.remote.service.Notifications
import com.claude.remote.ui.HostEditScreen
import com.claude.remote.ui.HostsScreen
import com.claude.remote.ui.SessionListScreen
import com.claude.remote.ui.theme.AppTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val serviceState = mutableStateOf<ConnectionService?>(null)
    private val pendingHost = mutableStateOf<String?>(null)
    private val pendingSession = mutableStateOf<String?>(null)
    private var bound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            serviceState.value = (binder as ConnectionService.LocalBinder).service()
        }
        override fun onServiceDisconnected(name: ComponentName?) { serviceState.value = null }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readNotificationExtras(intent)
        bindService(Intent(this, ConnectionService::class.java), connection, Context.BIND_AUTO_CREATE)
        bound = true

        val settings = Settings(applicationContext)
        setContent {
            AppTheme {
              Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                val service = serviceState.value ?: return@Box

                val notifPermission = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission()
                ) {}
                LaunchedEffect(Unit) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }

                val hosts by service.hosts.collectAsStateWithLifecycle()
                var screen by remember { mutableStateOf("loading") }
                var selectedHostId by remember { mutableStateOf<String?>(null) }
                var editing by remember { mutableStateOf<HostEntry?>(null) }
                var openSessionId by remember { mutableStateOf<String?>(null) }

                // 把设置里的电脑列表同步给服务（增删改 → 连接随动）
                LaunchedEffect(Unit) {
                    settings.hosts.collect { list ->
                        service.setHosts(list)
                        if (list.isEmpty()) {
                            editing = null; screen = "editHost"
                        } else {
                            if (selectedHostId == null || list.none { it.id == selectedHostId }) {
                                selectedHostId = list.first().id
                            }
                            if (screen == "loading") screen = "sessions"
                        }
                    }
                }

                // 通知点击 → 切到对应电脑并打开会话
                LaunchedEffect(pendingHost.value, pendingSession.value, hosts) {
                    val h = pendingHost.value; val s = pendingSession.value
                    if (h != null && s != null && hosts.any { it.id == h }) {
                        selectedHostId = h; openSessionId = s; screen = "terminal"
                        pendingHost.value = null; pendingSession.value = null
                    }
                }

                when (screen) {
                    "editHost" -> {
                        val e = editing
                        HostEditScreen(
                            isNew = e == null,
                            initialName = e?.name ?: "",
                            initialUrl = e?.url ?: "",
                            initialToken = e?.token ?: "",
                            onSave = { name, url, token ->
                                lifecycleScope.launch {
                                    if (e == null) {
                                        val added = settings.addHost(name, url, token)
                                        selectedHostId = added.id
                                    } else settings.updateHost(e.id, name, url, token)
                                    screen = "sessions"
                                }
                            },
                            onCancel = { screen = if (hosts.isEmpty()) "editHost" else "hosts" },
                            onDelete = if (e != null) {
                                {
                                    lifecycleScope.launch {
                                        settings.removeHost(e.id)
                                        screen = "hosts"
                                    }
                                }
                            } else null,
                        )
                    }
                    "hosts" -> HostsScreen(
                        hosts = hosts,
                        connStateOf = { id -> connLabel(service.connection(id)?.connState?.value) },
                        onEdit = { editing = it; screen = "editHost" },
                        onAdd = { editing = null; screen = "editHost" },
                        onBack = { screen = "sessions" },
                    )
                    "sessions" -> {
                        val hid = selectedHostId
                        val conn = hid?.let { service.connection(it) }
                        if (hid == null || conn == null) { screen = "loading" } else {
                            key(hid) {
                                val sessions by conn.repo.sessions.collectAsStateWithLifecycle()
                                val cs by conn.connState.collectAsStateWithLifecycle()
                                SessionListScreen(
                                    hostName = conn.entry.name,
                                    allHosts = hosts,
                                    onSelectHost = { selectedHostId = it },
                                    onManageHosts = { screen = "hosts" },
                                    sessions = sessions,
                                    connState = connLabel(cs),
                                    incoming = conn.incoming,
                                    send = { conn.send(it) },
                                    onOpen = { openSessionId = it.id; screen = "terminal" },
                                    onNew = { cwd -> conn.send(ClientMsg.Create(cwd = cwd)) },
                                )
                            }
                        }
                    }
                    "terminal" -> {
                        val hid = selectedHostId
                        val conn = hid?.let { service.connection(it) }
                        val sid = openSessionId
                        if (conn == null || sid == null) { screen = "sessions" } else {
                            BackHandler { screen = "sessions" }
                            com.claude.remote.ui.TerminalScreen(
                                sessionId = sid,
                                incoming = conn.incoming,
                                connState = conn.connState,
                                send = { conn.send(it) },
                            )
                        }
                    }
                }
              }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readNotificationExtras(intent)
    }

    private fun readNotificationExtras(intent: Intent?) {
        intent?.getStringExtra(Notifications.EXTRA_HOST_ID)?.let { pendingHost.value = it }
        intent?.getStringExtra(Notifications.EXTRA_SESSION_ID)?.let { pendingSession.value = it }
    }

    private fun connLabel(cs: ConnState?): String = when (cs) {
        ConnState.CONNECTED -> "已连接"
        ConnState.CONNECTING -> "连接中"
        else -> "未连接"
    }

    override fun onDestroy() {
        super.onDestroy()
        if (bound) { unbindService(connection); bound = false }
    }
}
