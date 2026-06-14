package com.claude.remote.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.claude.remote.MainActivity
import com.claude.remote.R

/** 通知渠道与构建。两个渠道：常驻连接（低优先级）、事件提醒（高优先级，会响/震）。 */
object Notifications {
    const val CHANNEL_ONGOING = "ongoing"
    const val CHANNEL_EVENT = "event"
    const val ONGOING_ID = 1
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_HOST_ID = "hostId"
    // 通知动作：发往 ConnectionService 的快捷输入（不打开 UI）
    const val ACTION_SEND_INPUT = "com.claude.remote.SEND_INPUT"
    const val EXTRA_INPUT = "input"

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ONGOING, "连接状态", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_EVENT, "会话提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                enableVibration(true)
            }
        )
    }

    /** 常驻前台通知（服务存活所需）。 */
    fun ongoing(ctx: Context, text: String): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_ONGOING)
            .setContentTitle("Claude Remote")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(openAppIntent(ctx, null, null))
            .build()

    /**
     * 事件提醒（停下/请求授权）。点击直达对应电脑的会话；带快捷按钮直接发输入（不开 UI）。
     * @param kind "stop" → 「继续」按钮；"permission_request" → 「批准」「拒绝」按钮
     */
    fun event(ctx: Context, hostId: String, sessionId: String, kind: String, title: String, text: String) {
        val esc = Char(27).toString()
        val cr = Char(13).toString()
        val b = NotificationCompat.Builder(ctx, CHANNEL_EVENT)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text)) // 多行展开看回复
            .setSmallIcon(R.drawable.ic_notification)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openAppIntent(ctx, hostId, sessionId))

        when (kind) {
            "stop" -> b.addAction(0, "继续", inputIntent(ctx, hostId, sessionId, "继续" + cr))
            "permission_request" -> {
                b.addAction(0, "批准", inputIntent(ctx, hostId, sessionId, cr))   // Enter 接受高亮的"是"
                b.addAction(0, "拒绝", inputIntent(ctx, hostId, sessionId, esc))  // Esc 取消
            }
        }
        // 用 (host+session) 的 hashCode 作为通知 id：同会话的新事件覆盖旧的
        NotificationManagerCompat.from(ctx).notify((hostId + sessionId).hashCode(), b.build())
    }

    /** 构造"发送输入到指定会话"的 PendingIntent（投递到 ConnectionService.onStartCommand）。 */
    private fun inputIntent(ctx: Context, hostId: String, sessionId: String, input: String): PendingIntent {
        val intent = Intent(ctx, ConnectionService::class.java).apply {
            action = ACTION_SEND_INPUT
            putExtra(EXTRA_HOST_ID, hostId)
            putExtra(EXTRA_SESSION_ID, sessionId)
            putExtra(EXTRA_INPUT, input)
        }
        val reqCode = (hostId + sessionId + input).hashCode()
        return PendingIntent.getService(
            ctx, reqCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun openAppIntent(ctx: Context, hostId: String?, sessionId: String?): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (hostId != null) putExtra(EXTRA_HOST_ID, hostId)
            if (sessionId != null) putExtra(EXTRA_SESSION_ID, sessionId)
        }
        val reqCode = ((hostId ?: "") + (sessionId ?: "")).hashCode()
        return PendingIntent.getActivity(
            ctx, reqCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
