package com.claude.remote.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.builtins.serializer

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Serializable
data class SessionDto(
    val id: String,
    val name: String,
    val cwd: String,
    val state: String,
    val createdAt: String,
    val orphaned: Boolean = false,
)

private fun q(s: String): String = json.encodeToString(String.serializer(), s)

/** 客户端→宿主。手写 encode 保证字段名/结构与宿主完全一致。 */
sealed interface ClientMsg {
    fun encode(): String
    data class Auth(val token: String) : ClientMsg {
        override fun encode() = """{"type":"auth","token":${q(token)}}"""
    }
    data object ListSessions : ClientMsg {
        override fun encode() = """{"type":"list"}"""
    }
    data class Create(val cwd: String, val name: String? = null) : ClientMsg {
        override fun encode() =
            if (name == null) """{"type":"create","cwd":${q(cwd)}}"""
            else """{"type":"create","cwd":${q(cwd)},"name":${q(name)}}"""
    }
    data class Attach(val sessionId: String, val cols: Int, val rows: Int) : ClientMsg {
        override fun encode() = """{"type":"attach","sessionId":${q(sessionId)},"cols":$cols,"rows":$rows}"""
    }
    data class Input(val sessionId: String, val dataB64: String) : ClientMsg {
        override fun encode() = """{"type":"input","sessionId":${q(sessionId)},"data":${q(dataB64)}}"""
    }
    data class Resize(val sessionId: String, val cols: Int, val rows: Int) : ClientMsg {
        override fun encode() = """{"type":"resize","sessionId":${q(sessionId)},"cols":$cols,"rows":$rows}"""
    }
    data class Detach(val sessionId: String) : ClientMsg {
        override fun encode() = """{"type":"detach","sessionId":${q(sessionId)}}"""
    }
    data class Kill(val sessionId: String) : ClientMsg {
        override fun encode() = """{"type":"kill","sessionId":${q(sessionId)}}"""
    }
    /** 请求列出某目录下的子目录（path 空串=默认根，宿主用用户主目录）。 */
    data class ListDir(val path: String) : ClientMsg {
        override fun encode() = """{"type":"listdir","path":${q(path)}}"""
    }
}

/** 宿主→客户端。 */
sealed interface HostMsg {
    data object AuthOk : HostMsg
    data class Sessions(val sessions: List<SessionDto>) : HostMsg
    data class Created(val sessionId: String) : HostMsg
    data class Output(val sessionId: String, val dataB64: String) : HostMsg
    data class Event(val sessionId: String, val kind: String, val preview: String = "") : HostMsg
    data class Error(val message: String) : HostMsg
    /** 目录列举结果：path 当前目录，parent 上级目录，entries 子目录名。 */
    data class Dir(val path: String, val parent: String, val entries: List<String>) : HostMsg
    data object Unknown : HostMsg
}

@Serializable private data class SessionsWire(val sessions: List<SessionDto> = emptyList())
@Serializable private data class DirWire(
    val path: String = "", val parent: String = "", val entries: List<String> = emptyList(),
)

fun decodeHostMsg(raw: String): HostMsg {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return HostMsg.Unknown
    fun str(k: String) = obj[k]?.jsonPrimitive?.contentOrNull
    return when (str("type")) {
        "auth_ok" -> HostMsg.AuthOk
        "sessions" -> HostMsg.Sessions(json.decodeFromString(SessionsWire.serializer(), raw).sessions)
        "created" -> HostMsg.Created(str("sessionId").orEmpty())
        "output" -> HostMsg.Output(str("sessionId").orEmpty(), str("data").orEmpty())
        "event" -> HostMsg.Event(str("sessionId").orEmpty(), str("kind").orEmpty(), str("preview").orEmpty())
        "error" -> HostMsg.Error(str("message").orEmpty())
        "dir" -> json.decodeFromString(DirWire.serializer(), raw).let { HostMsg.Dir(it.path, it.parent, it.entries) }
        else -> HostMsg.Unknown
    }
}
