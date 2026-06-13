package com.claude.remote

import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HostClientTest {
    private lateinit var server: MockWebServer
    @Before fun setup() { server = MockWebServer(); server.start() }
    @After fun teardown() { server.shutdown() }

    private fun wsUrl() = server.url("/").toString().replace("http://", "ws://").replace("https://", "wss://")

    @Test fun connects_and_emits_auth_then_receives_authok() = runBlocking {
        val received = Channel<String>(Channel.UNLIMITED)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                received.trySend(text)
                if (text.contains("\"type\":\"auth\"")) ws.send("""{"type":"auth_ok"}""")
            }
        }))
        val msgs = Channel<HostMsg>(Channel.UNLIMITED)
        val client = HostClient(
            url = wsUrl(),
            token = "tok",
            onMessage = { msgs.trySend(it) },
            onState = {},
        )
        client.connect()
        withTimeout(5000) {
            assertTrue(received.receive().contains("\"type\":\"auth\""))
            assertTrue(msgs.receive() is HostMsg.AuthOk)
        }
        client.close()
    }

    @Test fun send_list_after_connect() = runBlocking {
        val received = Channel<String>(Channel.UNLIMITED)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                received.trySend(text)
                if (text.contains("\"type\":\"auth\"")) ws.send("""{"type":"auth_ok"}""")
            }
        }))
        val client = HostClient(wsUrl(), "tok", {}, {})
        client.connect()
        withTimeout(5000) {
            received.receive() // auth
            client.send(com.claude.remote.net.ClientMsg.ListSessions)
            assertEquals(true, received.receive().contains("\"type\":\"list\""))
        }
        client.close()
    }
}
