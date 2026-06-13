package com.claude.remote

import com.claude.remote.data.SessionRepository
import com.claude.remote.net.HostMsg
import com.claude.remote.net.SessionDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionRepositoryTest {
    @Test fun sessions_message_updates_state() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.Sessions(listOf(
            SessionDto("a","p","C:/x","working","t"),
            SessionDto("b","q","C:/y","waiting","t", orphaned = true),
        )))
        assertEquals(2, repo.sessions.value.size)
        assertEquals("working", repo.sessions.value[0].state)
        assertEquals(true, repo.sessions.value[1].orphaned)
    }

    @Test fun error_message_is_exposed() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.Error("鉴权失败"))
        assertEquals("鉴权失败", repo.lastError.value)
    }

    @Test fun clearError_resets() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.Error("x"))
        repo.clearError()
        assertNull(repo.lastError.value)
    }

    @Test fun non_state_messages_ignored() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.AuthOk)
        repo.onHostMsg(HostMsg.Output("a","aGk="))
        assertEquals(0, repo.sessions.value.size)
        assertNull(repo.lastError.value)
    }
}
