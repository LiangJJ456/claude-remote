package com.claude.remote

import com.claude.remote.net.ClientMsg
import com.claude.remote.net.HostMsg
import com.claude.remote.net.decodeHostMsg
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test fun auth_encodes_with_type_and_token() {
        val json = ClientMsg.Auth("tok123").encode()
        assertTrue(json.contains("\"type\":\"auth\""))
        assertTrue(json.contains("\"token\":\"tok123\""))
    }

    @Test fun attach_encodes_all_fields() {
        val json = ClientMsg.Attach("s1", 80, 24).encode()
        assertTrue(json.contains("\"type\":\"attach\""))
        assertTrue(json.contains("\"sessionId\":\"s1\""))
        assertTrue(json.contains("\"cols\":80"))
        assertTrue(json.contains("\"rows\":24"))
    }

    @Test fun decode_sessions_message() {
        val raw = """{"type":"sessions","sessions":[{"id":"a","name":"proj","cwd":"C:/x","state":"waiting","createdAt":"t","orphaned":true}]}"""
        val msg = decodeHostMsg(raw)
        assertTrue(msg is HostMsg.Sessions)
        val s = (msg as HostMsg.Sessions).sessions.single()
        assertEquals("a", s.id); assertEquals("waiting", s.state); assertEquals(true, s.orphaned)
    }

    @Test fun decode_output_and_event() {
        assertTrue(decodeHostMsg("""{"type":"output","sessionId":"a","data":"aGk="}""") is HostMsg.Output)
        val ev = decodeHostMsg("""{"type":"event","sessionId":"a","kind":"stop"}""")
        assertTrue(ev is HostMsg.Event); assertEquals("stop", (ev as HostMsg.Event).kind)
    }

    @Test fun decode_unknown_type_is_Unknown_not_crash() {
        assertTrue(decodeHostMsg("""{"type":"weird"}""") is HostMsg.Unknown)
    }

    @Test fun create_without_name_omits_name_field() {
        val json = ClientMsg.Create(cwd = "C:/x").encode()
        assertTrue(json.contains("\"type\":\"create\""))
        assertTrue(json.contains("\"cwd\":\"C:/x\""))
        assertTrue(!json.contains("\"name\""))
    }

    @Test fun input_carries_base64_data() {
        val json = ClientMsg.Input("s1", "aGk=").encode()
        assertTrue(json.contains("\"type\":\"input\""))
        assertTrue(json.contains("\"data\":\"aGk=\""))
    }
}
