package com.clicksolution.wifimonitor

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// ─── AlarmManager receiver — מתעורר גם ב-Doze Mode ──────
class DozeAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        android.util.Log.d("DozeAlarm", "Alarm fired — restarting scan service")

        // הפעל את הסרביס
        try {
            val serviceIntent = Intent(context, ScanForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            android.util.Log.w("DozeAlarm", "Start from alarm failed: ${e.message}")
        }

        // תזמן את האזעקה הבאה
        scheduleNextAlarm(context)
    }

    companion object {
        private const val REQUEST_CODE = 9001
        private const val INTERVAL_MS  = 5 * 60 * 1000L // 5 דקות

        fun scheduleNextAlarm(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                Intent(context, DozeAlarmReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val triggerAt = System.currentTimeMillis() + INTERVAL_MS

            // setExactAndAllowWhileIdle — עובד גם ב-Doze Mode
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, intent)
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, intent)
            }

            android.util.Log.d("DozeAlarm", "Next alarm in ${INTERVAL_MS/1000}s")
        }

        fun cancel(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                Intent(context, DozeAlarmReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.cancel(intent)
            android.util.Log.d("DozeAlarm", "Alarm cancelled")
        }
    }
}