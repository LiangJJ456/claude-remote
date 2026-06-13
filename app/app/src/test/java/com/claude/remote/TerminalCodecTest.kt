package com.claude.remote

import com.claude.remote.terminal.TerminalCodec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalCodecTest {
    @Test fun decodeOutput_base64_to_bytes() {
        assertArrayEquals("hi".toByteArray(), TerminalCodec.decodeOutput("aGk="))
    }

    @Test fun encodeInput_slice_is_base64() {
        val msg = TerminalCodec.encodeInput("s1", "XhiX".toByteArray(), 1, 2) // 切出 "hi"
        assertEquals("s1", msg.sessionId)
        assertEquals("aGk=", msg.dataB64)
    }

    @Test fun input_roundtrips_through_output_decode() {
        val bytes = byteArrayOf(13, 27, 91, 65) // \r ESC [ A（回车 + 上箭头控制序列）
        val msg = TerminalCodec.encodeInput("s", bytes, 0, bytes.size)
        assertArrayEquals(bytes, TerminalCodec.decodeOutput(msg.dataB64))
    }

    @Test fun encodeInput_multibyte_utf8() {
        val bytes = "你".toByteArray(Charsets.UTF_8) // 3 字节 utf8
        val msg = TerminalCodec.encodeInput("s", bytes, 0, bytes.size)
        assertArrayEquals(bytes, TerminalCodec.decodeOutput(msg.dataB64))
    }
}
