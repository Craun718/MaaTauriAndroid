package top.natsuu.mta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object NotificationCompat {
    fun notification(
        context: Context,
        channelId: String,
        channelNameResource: Int,
        titleResource: Int,
        textResource: Int,
    ): Notification {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                channelId,
                context.getString(channelNameResource),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        return Notification.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(context.getString(titleResource))
            .setContentText(context.getString(textResource))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }
}
