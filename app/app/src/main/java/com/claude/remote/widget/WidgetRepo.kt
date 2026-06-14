package com.claude.remote.widget

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/** 小组件快照的一条：哪台电脑的哪个会话、什么状态。 */
@Serializable
data class WidgetItem(
    val hostId: String,
    val hostName: String,
    val sessionId: String,
    val sessionName: String,
    val state: String, // working | waiting | exited
)

/** 小组件数据快照：服务写、小组件读（filesDir 下的 json，跨进程/重启可用）。 */
object WidgetRepo {
    private val json = Json { ignoreUnknownKeys = true }
    private fun file(ctx: Context) = File(ctx.filesDir, "widget.json")

    fun save(ctx: Context, items: List<WidgetItem>) {
        runCatching { file(ctx).writeText(json.encodeToString(items)) }
    }

    fun load(ctx: Context): List<WidgetItem> =
        runCatching { json.decodeFromString<List<WidgetItem>>(file(ctx).readText()) }.getOrDefault(emptyList())
}
