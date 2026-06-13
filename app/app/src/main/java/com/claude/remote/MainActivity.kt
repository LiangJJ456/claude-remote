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
import com.claude.remote.data.Settings
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.service.ConnectionService
import com.claude.remote.service.Notifications
import com.claude.remote.ui.SessionListScreen
import com.claude.remote.ui.SettingsScreen
import com.claude.remote.ui.TerminalScreen
import com.claude.remote.ui.theme.AppTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val serviceState = mutableStateOf<ConnectionService?>(null)
    /** 通知点击带来的待打开会话 id（onCreate/onNewIntent 写入，Compose 消费）。 */
    private val pendingOpen = mutableStateOf<String?>(null)
    private var bound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            serviceState.value = (binder as ConnectionService.LocalBinder).service()
        }
        override fun onServiceDisconnected(name: ComponentName?) { serviceState.value = null }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.getStringExtra(Notifications.EXTRA_SESSION_ID)?.let { pendingOpen.value = it }

        val svc = Intent(this, ConnectionService::class.java)
        bindService(svc, connection, Context.BIND_AUTO_CREATE)
        bound = true

        val settings = Settings(applicationContext)
        setContent {
            AppTheme {
              Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                val service = serviceState.value
                if (service == null) {
                    return@Box // 等待服务绑定
                }

                // Android 13+ 通知权限
                val notifPermission = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission()
                ) {}
                LaunchedEffect(Unit) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                }

                var screen by remember { mutableStateOf("loading") }
                var cfgUrl by remember { mutableStateOf("") }
                var cfgToken by remember { mutableStateOf("") }
                var openSessionId by remember { mutableStateOf<String?>(null) }
                val sessions by service.repo.sessions.collectAsStateWithLifecycle()
                val conn by service.connState.collectAsStateWithLifecycle()

                LaunchedEffect(Unit) {
                    val c = settings.config.first()
                    cfgUrl = c.url; cfgToken = c.token
                    if (c.isConfigured) { startConnection(c.url, c.token); screen = "list" } else screen = "settings"
                }

                // 通知点击 → 跳到对应会话终端
                LaunchedEffect(pendingOpen.value, screen) {
                    val sid = pendingOpen.value
                    if (sid != null && screen != "loading" && screen != "settings") {
                        openSessionId = sid; screen = "terminal"; pendingOpen.value = null
                    }
                }

                when (screen) {
                    "settings" -> SettingsScreen(cfgUrl, cfgToken) { url, token ->
                        lifecycleScope.launch {
                            settings.save(url, token); cfgUrl = url; cfgToken = token
                            startConnection(url, token); screen = "list"
                        }
                    }
                    "list" -> SessionListScreen(
                        sessions = sessions,
                        connState = when (conn) {
                            ConnState.CONNECTED -> "已连接"
                            ConnState.CONNECTING -> "连接中"
                            else -> "未连接"
                        },
                        onOpen = { openSessionId = it.id; screen = "terminal" },
                        onNew = { cwd -> service.send(ClientMsg.Create(cwd = cwd)) },
                        onSettings = { screen = "settings" },
                    )
                    "terminal" -> {
                        val sid = openSessionId
                        if (sid == null) { screen = "list" } else {
                            BackHandler { screen = "list" }
                            TerminalScreen(
                                sessionId = sid,
                                incoming = service.incoming,
                                connState = service.connState,
                                send = { service.send(it) },
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
        intent.getStringExtra(Notifications.EXTRA_SESSION_ID)?.let { pendingOpen.value = it }
    }

    /** 启动并前台化服务（survive 后台）+ 连接。 */
    private fun startConnection(url: String, token: String) {
        val svc = Intent(this, ConnectionService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc) else startService(svc)
        serviceState.value?.start(url, token)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (bound) { unbindService(connection); bound = false }
    }
}
