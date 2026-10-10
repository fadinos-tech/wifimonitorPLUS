package com.clicksolution.wifimonitor

import android.content.Context
import android.os.PowerManager
import com.facebook.react.bridge.*

class WakeLockModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun getName() = "WakeLockModule"

    @ReactMethod
    fun acquire() {
        if (wakeLock?.isHeld == true) return
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "WifiMonitor::ScanWakeLock"
        )
        wakeLock?.setReferenceCounted(false)
        wakeLock?.acquire(60 * 60 * 1000L) // max 1 hour
    }

    @ReactMethod
    fun release() {
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        wakeLock = null
    }

    @ReactMethod
    fun isHeld(promise: Promise) {
        promise.resolve(wakeLock?.isHeld == true)
    }
}
