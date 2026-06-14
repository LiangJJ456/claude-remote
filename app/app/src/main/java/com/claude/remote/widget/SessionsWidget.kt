package com.claude.remote.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.claude.remote.MainActivity
import com.claude.remote.service.Notifications

/** 各会话状态列表小组件。数据由 ConnectionService 写入 WidgetRepo，点击会话直达 app。 */
class SessionsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val items = WidgetRepo.load(context)
        provideContent { Content(context, items) }
    }

    @Composable
    private fun Content(context: Context, items: List<WidgetItem>) {
        Column(GlanceModifier.fillMaxSize().background(Color(0xFF1F1E1D)).padding(8.dp)) {
            Text(
                "Claude 会话",
                style = TextStyle(color = ColorProvider(Color(0xFFD97757)), fontSize = 14.sp),
                modifier = GlanceModifier.padding(bottom = 4.dp),
            )
            if (items.isEmpty()) {
                Text("无会话（打开 app 连接）", style = TextStyle(color = ColorProvider(Color.Gray), fontSize = 12.sp))
            } else {
                LazyColumn { items(items) { item -> Item(context, item) } }
            }
        }
    }

    @Composable
    private fun Item(context: Context, item: WidgetItem) {
        val (label, color) = when (item.state) {
            "working" -> "干活中" to Color(0xFF6EC1FF)
            "waiting" -> "等输入" to Color(0xFFFFD866)
            else -> "已结束" to Color.Gray
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(Notifications.EXTRA_HOST_ID, item.hostId)
            putExtra(Notifications.EXTRA_SESSION_ID, item.sessionId)
        }
        Row(
            GlanceModifier.fillMaxWidth().padding(vertical = 6.dp).clickable(actionStartActivity(intent)),
        ) {
            Text(
                "${item.hostName} · ${item.sessionName}",
                style = TextStyle(color = ColorProvider(Color(0xFFE0E0E0)), fontSize = 13.sp),
                modifier = GlanceModifier.defaultWeight(),
            )
            Text(label, style = TextStyle(color = ColorProvider(color), fontSize = 13.sp))
        }
    }
}

class SessionsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SessionsWidget()
}
