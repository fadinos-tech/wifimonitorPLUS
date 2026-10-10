package com.clicksolution.wifimonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class ScreenStateModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    private var receiver: BroadcastReceiver? = null

    override fun getName() = "ScreenStateModule"

    // ─── קרא את מצב המסך הנוכחי ──────────────────────────
    @ReactMethod
    fun getScreenState(promise: Promise) {
        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            val isOn = pm.isInteractive
            promise.resolve(if (isOn) "on" else "off")
        } catch (e: Exception) {
            promise.reject("SCREEN_STATE_ERROR", e.message)
        }
    }

    // ─── התחל להאזין לאירועי מסך ─────────────────────────
    @ReactMethod
    fun startListening() {
        if (receiver != null) return

        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val event = when (intent.action) {
                    Intent.ACTION_SCREEN_OFF   -> "SCREEN_OFF"
                    Intent.ACTION_SCREEN_ON    -> "SCREEN_ON"
                    Intent.ACTION_USER_PRESENT -> "USER_PRESENT"
                    else -> return
                }
                sendEvent(event)
            }
        }

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }

        ctx.registerReceiver(receiver, filter)
    }

    // ─── הפסק להאזין ─────────────────────────────────────
    @ReactMethod
    fun stopListening() {
        receiver?.let {
            try { ctx.unregisterReceiver(it) } catch (_: Exception) {}
            receiver = null
        }
    }

    // ─── שלח event ל-JS ───────────────────────────────────
    private fun sendEvent(eventName: String) {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("ScreenStateEvent", eventName)
    }

    override fun invalidate() {
        stopListening()
        super.invalidate()
    }
}
