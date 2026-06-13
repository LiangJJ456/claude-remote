package com.claude.remote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.claude.remote.data.Settings
import com.claude.remote.data.SessionRepository
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import com.claude.remote.ui.SessionListScreen
import com.claude.remote.ui.SettingsScreen
import com.claude.remote.ui.TerminalScreen
import com.claude.remote.ui.theme.AppTheme
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val repo = SessionRepository()
    private var client: HostClient? = null
    private val connState = mutableStateOf(ConnState.DISCONNECTED)
    /** 宿主下行消息流，供终端页消费 output。extraBufferCapacity 防止 tryEmit 丢帧。 */
    private val incoming = MutableSharedFlow<HostMsg>(extraBufferCapacity = 512)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val settings = Settings(applicationContext)
        setContent {
            AppTheme {
                var screen by remember { mutableStateOf("loading") }
                var cfgUrl by remember { mutableStateOf("") }
                var cfgToken by remember { mutableStateOf("") }
                var openSessionId by remember { mutableStateOf<String?>(null) }
                val sessions by repo.sessions.collectAsStateWithLifecycle()
                val conn by connState

                LaunchedEffect(Unit) {
                    val c = settings.config.first()
                    cfgUrl = c.url; cfgToken = c.token
                    screen = if (c.isConfigured) { connect(c.url, c.token); "list" } else "settings"
                }

                when (screen) {
                    "settings" -> SettingsScreen(cfgUrl, cfgToken) { url, token ->
                        lifecycleScope.launch {
                            settings.save(url, token); cfgUrl = url; cfgToken = token
                            connect(url, token); screen = "list"
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
                        onNew = { client?.send(ClientMsg.Create(cwd = "C:\\Users\\galaxy\\code")) },
                        onSettings = { screen = "settings" },
                    )
                    "terminal" -> {
                        val sid = openSessionId
                        if (sid == null) { screen = "list" } else {
                            BackHandler { screen = "list" }
                            TerminalScreen(
                                sessionId = sid,
                                incoming = incoming,
                                send = { client?.send(it) },
                            )
                        }
                    }
                }
            }
        }
    }

    private fun connect(url: String, token: String) {
        client?.close()
        client = HostClient(
            url = url, token = token,
            onMessage = { msg ->
                runOnUiThread {
                    repo.onHostMsg(msg)
                    incoming.tryEmit(msg)
                    if (msg is HostMsg.AuthOk) client?.send(ClientMsg.ListSessions)
                    if (msg is HostMsg.Created) client?.send(ClientMsg.ListSessions)
                }
            },
            onState = { runOnUiThread { connState.value = it } },
        )
        client!!.connect()
    }

    override fun onDestroy() { super.onDestroy(); client?.close() }
}
