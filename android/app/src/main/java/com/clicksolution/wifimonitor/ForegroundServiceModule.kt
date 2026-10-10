package com.clicksolution.wifimonitor

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import com.facebook.react.bridge.*

class ForegroundServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ForegroundServiceModule"

    @ReactMethod
    fun start(homeId: String, deviceId: String, intervalSeconds: Int) {
        val intent = Intent(reactContext, ScanForegroundService::class.java).apply {
            putExtra("homeId",          homeId)
            putExtra("deviceId",        deviceId)
            putExtra("intervalSeconds", intervalSeconds)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
        android.util.Log.d("ForegroundService", "Started")
    }

    @ReactMethod
    fun stop() {
        reactContext.stopService(Intent(reactContext, ScanForegroundService::class.java))
        android.util.Log.d("ForegroundService", "Stopped")
    }

    // עוזבים Home: לעצור את השירות *ולמחוק* את ה-session הנייטיבי.
    // בלי זה השירות היה עולה שוב באתחול הטלפון וממשיך להעלות לבית הישן.
    @ReactMethod
    fun clearSession(promise: Promise) {
        try {
            reactContext.stopService(Intent(reactContext, ScanForegroundService::class.java))
            reactContext.getSharedPreferences("wifi_monitor", Context.MODE_PRIVATE)
                .edit().clear().apply()
            reactContext.getSharedPreferences("wifi_offline_queue", Context.MODE_PRIVATE)
                .edit().clear().apply()
            android.util.Log.d("ForegroundService", "Native session cleared")
            promise.resolve(true)
        } catch (e: Exception) {
            android.util.Log.w("ForegroundService", "clearSession failed: ${e.message}")
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations() {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                val intent = Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
                reactContext.startActivity(intent)
            }
        } catch (e: Exception) {
            android.util.Log.w("ForegroundService", "Battery opt request failed: ${e.message}")
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        promise.resolve(pm.isIgnoringBatteryOptimizations(reactContext.packageName))
    }

    @ReactMethod
    fun triggerUpload(promise: Promise) {
        val intent = Intent(reactContext, ScanForegroundService::class.java).apply {
            putExtra("action", "UPLOAD_NOW")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
        android.util.Log.d("ForegroundService", "triggerUpload sent")
        promise.resolve(true)
    }
}