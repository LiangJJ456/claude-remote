package com.claude.remote.terminal

import com.claude.remote.net.ClientMsg
import java.util.Base64

/**
 * 终端字节流与协议消息之间的纯编解码（无 Android 依赖，可单测）。
 * 宿主的 output/input 的 data 字段都是 base64。java.util.Base64 在 minSdk 26 可用。
 */
object TerminalCodec {
    /** 宿主 output 的 base64 → 原始字节，喂给 emulator.appendBytes。 */
    fun decodeOutput(b64: String): ByteArray = Base64.getDecoder().decode(b64)

    /** 用户输入的字节切片 → ClientMsg.Input（base64），发回宿主。 */
    fun encodeInput(sessionId: String, data: ByteArray, offset: Int, count: Int): ClientMsg.Input {
        val slice = data.copyOfRange(offset, offset + count)
        return ClientMsg.Input(sessionId, Base64.getEncoder().encodeToString(slice))
    }
}
