package com.claude.remote.data

import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 纯逻辑状态容器：消费 HostMsg，维护会话列表与最近错误，供 UI 观察。
 * 不直接持有网络/线程，便于单测。
 */
class SessionRepository {
    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions
    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    fun onHostMsg(msg: HostMsg) {
        when (msg) {
            is HostMsg.Sessions -> _sessions.value = msg.sessions.map {
                Session(it.id, it.name, it.cwd, it.state, it.createdAt, it.orphaned)
            }
            is HostMsg.Error -> _lastError.value = msg.message
            else -> {}
        }
    }

    fun clearError() { _lastError.value = null }
}
