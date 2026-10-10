package com.clicksolution.wifimonitor

import android.content.Context
import android.os.BatteryManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class BatteryModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName() = "BatteryModule"

    @ReactMethod
    fun getBatteryLevel(promise: Promise) {
        try {
            val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            promise.resolve(level)
        } catch (e: Exception) {
            promise.reject("BATTERY_ERROR", e.message)
        }
    }
}
