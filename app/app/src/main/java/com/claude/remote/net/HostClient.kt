package com.claude.remote.net

import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

enum class ConnState { CONNECTING, CONNECTED, DISCONNECTED }

/**
 * 宿主 WebSocket 客户端。连接成功后自动发送 auth。
 * onMessage/onState 在 OkHttp 的 WS 线程回调；调用方自行切线程。
 */
class HostClient(
    private val url: String,
    private val token: String,
    private val onMessage: (HostMsg) -> Unit,
    private val onState: (ConnState) -> Unit,
) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        // Use a zero-idle connection pool so connections are not kept alive after close,
        // which allows MockWebServer (and real teardown) to shut down immediately.
        .connectionPool(ConnectionPool(0, 1, TimeUnit.NANOSECONDS))
        .build()
    @Volatile private var ws: WebSocket? = null

    fun connect() {
        onState(ConnState.CONNECTING)
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(ClientMsg.Auth(token).encode())
                onState(ConnState.CONNECTED)
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                onMessage(decodeHostMsg(text))
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onState(ConnState.DISCONNECTED)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onState(ConnState.DISCONNECTED)
            }
        })
    }

    fun send(msg: ClientMsg) { ws?.send(msg.encode()) }

    fun close() {
        // cancel() immediately closes the underlying socket (vs close() which does a
        // graceful WS handshake and leaves the TCP socket in OkHttp's connection pool).
        // This is required so MockWebServer (and production teardown) can shut down
        // without waiting for the pool's keep-alive timeout.
        ws?.cancel()
        ws = null
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
