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
            .setContentIntent(openAppIntent(ctx, null))
            .build()

    /** 事件提醒（停下/请求授权）。点击直达对应会话终端页。 */
    fun event(ctx: Context, sessionId: String, title: String, text: String) {
        val n = NotificationCompat.Builder(ctx, CHANNEL_EVENT)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openAppIntent(ctx, sessionId))
            .build()
        // 用 sessionId 的 hashCode 作为通知 id：同会话的新事件覆盖旧的
        NotificationManagerCompat.from(ctx).notify(sessionId.hashCode(), n)
    }

    private fun openAppIntent(ctx: Context, sessionId: String?): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (sessionId != null) putExtra(EXTRA_SESSION_ID, sessionId)
        }
        val reqCode = sessionId?.hashCode() ?: 0
        return PendingIntent.getActivity(
            ctx, reqCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
