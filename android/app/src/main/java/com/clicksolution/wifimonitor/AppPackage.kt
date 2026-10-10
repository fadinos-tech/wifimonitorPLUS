package com.clicksolution.wifimonitor

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(
        WakeLockModule(ctx),
        BatteryModule(ctx),
        ScreenStateModule(ctx),
        ArpModule(ctx),
        ForegroundServiceModule(ctx),
    )

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}