package com.clicksolution.wifimonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            // No saved session — nothing to scan, don't start
            val prefs = context.getSharedPreferences("wifi_monitor", Context.MODE_PRIVATE)
            if (prefs.getString("homeId", null) == null || prefs.getString("deviceId", null) == null) return
            try {
                val serviceIntent = Intent(context, ScanForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            } catch (e: Exception) {
                android.util.Log.w("BootReceiver", "Start on boot failed: ${e.message}")
            }
        }
    }
}
