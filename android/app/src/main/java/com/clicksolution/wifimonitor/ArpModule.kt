package com.clicksolution.wifimonitor

import com.facebook.react.bridge.*

class ArpModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ArpModule"

    @ReactMethod
    fun scanLan(deviceIp: String, promise: Promise) {
        Thread {
            try {
                val devices = LanScanner.scan(reactApplicationContext, deviceIp)

                val result = Arguments.createArray()
                devices.forEach { device ->
                    val entry = Arguments.createMap()
                    entry.putString("ip",       device.ip)
                    entry.putString("mac",      device.mac)
                    entry.putString("hostname", device.hostname)
                    result.pushMap(entry)
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("SCAN_ERROR", e.message)
            }
        }.start()
    }
}