package com.clicksolution.wifimonitor

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.text.format.Formatter
import androidx.core.app.NotificationCompat
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FieldValue
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.pow

class ScanForegroundService : Service() {

    // ─── Executors ─────────────────────────────────────────
    private val pingExecutor:   ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val wifiExecutor:   ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val uploadExecutor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val retryExecutor:  ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val lanExecutor:    ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    // ─── State ─────────────────────────────────────────────
    private var wakeLock: PowerManager.WakeLock? = null
    private var isRunning    = false
    private var homeId:   String? = null
    private var deviceId: String? = null

    // ─── Intervals ─────────────────────────────────────────
    private val PING_INTERVAL_MS   = 1_000L  // כל שנייה
    private val WIFI_INTERVAL_S    = 30L     // כל 30 שניות
    private val UPLOAD_INTERVAL_S  = 30L     // כל 30 שניות
    private val NEARBY_INTERVAL_MS = 15 * 60 * 1000L // כל 15 דקות
    private val LAN_INTERVAL_S     = 15 * 60L        // כל 15 דקות
    private val LAN_INTERVAL_MS    = 15 * 60 * 1000L // כל 15 דקות
    private val BATTERY_INTERVAL_MS = 5 * 60 * 1000L // כל 5 דקות
    private val PUBLIC_IP_INTERVAL_MS = 5 * 60 * 1000L // כל 5 דקות

    // ─── Ping buffer — נאגר בין uploads ──────────────────
    data class PingReading(val gatewayMs: Int, val internetMs: Int, val ts: Long = System.currentTimeMillis())
    private val pingBuffer = CopyOnWriteArrayList<PingReading>()

    // ─── WiFi snapshot נוכחי ─────────────────────────────
    @Volatile private var currentWifi: WifiSnapshot? = null
    data class WifiSnapshot(
        val ssid: String, val bssid: String, val rssi: Int,
        val freq: Int, val ip: String, val txSpeed: Int, val rxSpeed: Int,
        val gateway: String, val dns1: String, val dns2: String,
        val channel: Int, val band: String
    )

    // ─── Roaming + Band Steering ──────────────────────────
    private var lastBssid: String? = null
    private var lastBand:  String? = null

    // ─── Nearby + LAN timestamps ─────────────────────────
    private var lastNearbyScan  = 0L
    private var lastLanScan     = 0L
    private var lastBatteryScan = 0L
    private var lastPublicIpCheck = 0L
    private var lastNearbyNetworks: List<Map<String, Any>> = emptyList()

    // ─── Battery + Public IP ─────────────────────────────
    @Volatile private var currentBattery = -1
    @Volatile private var currentPublicIp: String? = null
    @Volatile private var lastPublicIp: String? = null

    // ─── Screen state ─────────────────────────────────────
    private var currentScreenState = "on"
    private var currentAppState    = "background"

    // ─── Retry queue ──────────────────────────────────────
    private val retryQueue = LinkedBlockingQueue<Map<String, Any>>(100)

    // ─── NetworkCallback — WiFi info ב-Android 13+ ────────
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var activeWifiInfo: WifiInfo? = null

    // ─── Outage tracking ──────────────────────────────────
    @Volatile private var isInOutage      = false
    @Volatile private var outageStartTime = 0L
    @Volatile private var lastRssi        = 0
    @Volatile private var lastSsid        = ""
    private val OFFLINE_PREFS             = "wifi_offline_queue"
    private val MAX_QUEUE_BYTES           = 5 * 1024 * 1024L // 5MB

    // ─── BroadcastReceivers ───────────────────────────────
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            currentScreenState = when (intent.action) {
                Intent.ACTION_SCREEN_OFF   -> "off"
                Intent.ACTION_SCREEN_ON    -> "on"
                Intent.ACTION_USER_PRESENT -> "on"
                else -> currentScreenState
            }
        }
    }

    // ─── Roaming receiver — מיידי כשWiFi משתנה ────────────
    private val wifiStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action == WifiManager.NETWORK_STATE_CHANGED_ACTION) {
                val wifi = currentWifi ?: return
                checkRoaming(wifi.bssid, wifi.band, wifi.rssi)
            }
        }
    }

    companion object {
        private const val PREFS_NAME = "wifi_monitor"
        private const val RETRY_KEY  = "native_retry_queue"
        private const val MAX_RETRY  = 100
    }

    // ─── Lifecycle ─────────────────────────────────────────
    override fun onCreate() {
        super.onCreate()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WifiMonitor::ScanLock")
        wakeLock?.setReferenceCounted(false)
        currentScreenState = if (pm.isInteractive) "on" else "off"

        // Screen receiver
        registerReceiver(screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        })

        // WiFi state receiver לroaming מיידי
        registerReceiver(wifiStateReceiver, IntentFilter(WifiManager.NETWORK_STATE_CHANGED_ACTION))

        // NetworkCallback לAndroid 13+
        setupNetworkCallback()

        // התחברות אנונימית — השירות עולה גם באתחול הטלפון, בלי שה-JS רץ
        ensureAuth()
    }

    // ─── Anonymous auth ───────────────────────────────────
    // ה-token נשמר מקומית, ולכן בדרך כלל currentUser כבר קיים.
    // כישלון כאן לא עוצר את הסריקות — ה-rules עדיין מתירים כתיבה ללא auth.
    private fun ensureAuth() {
        try {
            val auth = com.google.firebase.auth.FirebaseAuth.getInstance()
            if (auth.currentUser != null) return
            auth.signInAnonymously()
                .addOnSuccessListener { android.util.Log.d("NativeScan", "Anonymous sign-in OK: ${it.user?.uid}") }
                .addOnFailureListener { android.util.Log.w("NativeScan", "Anonymous sign-in failed: ${it.message}") }
        } catch (e: Exception) {
            android.util.Log.w("NativeScan", "ensureAuth error: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        homeId   = intent?.getStringExtra("homeId")   ?: loadPref("homeId")
        deviceId = intent?.getStringExtra("deviceId") ?: loadPref("deviceId")

        if (homeId   != null) savePref("homeId",   homeId!!)
        if (deviceId != null) savePref("deviceId", deviceId!!)

        // חובה תוך 5 שניות מ-startForegroundService(), אחרת המערכת מקריסה את התהליך
        startForegroundNotification()

        // אין session (המשתמש עזב Home) — אל תסרוק ואל תשאיר התראה תלויה
        if (homeId == null || deviceId == null) {
            android.util.Log.d("NativeScan", "No session — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        // UPLOAD_NOW — upload מיידי
        if (intent?.getStringExtra("action") == "UPLOAD_NOW") {
            android.util.Log.d("NativeScan", "Manual upload triggered")
            Thread { doUpload(force = true) }.start()
            return START_STICKY
        }

        if (!isRunning) {
            isRunning = true
            if (wakeLock?.isHeld == false) wakeLock?.acquire()
            loadRetryQueue()

            // Ping כל שנייה
            pingExecutor.scheduleAtFixedRate({ doPing() }, 0, PING_INTERVAL_MS, TimeUnit.MILLISECONDS)

            // WiFi scan כל 30 שניות
            wifiExecutor.scheduleAtFixedRate({ doWifiScan() }, 0, WIFI_INTERVAL_S, TimeUnit.SECONDS)

            // Upload כל 30 שניות
            uploadExecutor.scheduleAtFixedRate({ doUpload() }, UPLOAD_INTERVAL_S, UPLOAD_INTERVAL_S, TimeUnit.SECONDS)

            // Retry כל דקה
            retryExecutor.scheduleAtFixedRate({ flushRetryQueue() }, 60, 60, TimeUnit.SECONDS)

            // LAN scan — בהתחלה וכל 15 דקות
            lanExecutor.scheduleAtFixedRate({ doLanScan() }, 0, LAN_INTERVAL_S, TimeUnit.SECONDS)

            android.util.Log.d("NativeScan", "Started: homeId=$homeId")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        pingExecutor.shutdownNow()
        wifiExecutor.shutdownNow()
        uploadExecutor.shutdownNow()
        retryExecutor.shutdownNow()
        lanExecutor.shutdownNow()
        if (wakeLock?.isHeld == true) wakeLock?.release()
        try { unregisterReceiver(screenReceiver) } catch (_: Exception) {}
        try { unregisterReceiver(wifiStateReceiver) } catch (_: Exception) {}
        networkCallback?.let {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it)
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ─── NetworkCallback לAndroid 12+ ─────────────────────
    private fun setupNetworkCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        networkCallback = object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {

            override fun onAvailable(network: Network) {
                if (isInOutage) onWifiReconnected()
            }

            override fun onLost(network: Network) {
                if (!isInOutage) onWifiDisconnected()
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                activeWifiInfo = caps.transportInfo as? WifiInfo
                val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                if (!validated && !isInOutage) {
                    onWifiDisconnected()
                } else if (validated && isInOutage) {
                    onWifiReconnected()
                }
            }
        }
        try { cm.registerNetworkCallback(request, networkCallback!!) } catch (_: Exception) {}
    }

    private fun onWifiDisconnected() {
        isInOutage      = true
        outageStartTime = System.currentTimeMillis()
        android.util.Log.d("Outage", "WiFi disconnected at $outageStartTime")
        updateNotification("WiFi disconnected — saving locally...")

        val hId = homeId  ?: return
        val dId = deviceId ?: return
        val event = hashMapOf(
            "type"       to "wifi_disconnect",
            "device_id"  to dId,
            "timestamp"  to com.google.firebase.Timestamp.now(),
            "rssi"       to lastRssi,
            "ssid"       to lastSsid,
            "bssid"      to lastBssid,
        )
        FirebaseFirestore.getInstance()
            .collection("homes").document(hId)
            .collection("events").add(event)
            .addOnFailureListener { e -> android.util.Log.w("Outage", "Failed to log disconnect: ${e.message}") }
    }

    private fun onWifiReconnected() {
        if (!isInOutage) return
        val duration = System.currentTimeMillis() - outageStartTime
        isInOutage = false
        android.util.Log.d("Outage", "WiFi reconnected after ${duration}ms")
        updateNotification("WiFi reconnected — uploading saved data...")

        val hId = homeId  ?: return
        val dId = deviceId ?: return
        val event = hashMapOf(
            "type"        to "wifi_reconnect",
            "device_id"   to dId,
            "timestamp"   to com.google.firebase.Timestamp.now(),
            "duration_ms" to duration,
            "duration_min" to (duration / 60000.0),
            "rssi"        to lastRssi,
        )
        FirebaseFirestore.getInstance()
            .collection("homes").document(hId)
            .collection("events").add(event)

        // Flush offline queue in background
        uploadExecutor.submit { flushOfflineQueue() }
    }

    private fun saveToOfflineQueue(scan: Map<String, Any>) {
        try {
            val prefs = getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
            val allKeys = prefs.all
            // Check size
            val totalSize = allKeys.values.sumOf { (it as? String)?.length?.toLong() ?: 0L }
            if (totalSize > MAX_QUEUE_BYTES) {
                android.util.Log.w("OfflineQueue", "Queue full (${totalSize/1024}KB) — stopping scans")
                updateNotification("Offline log full — scans paused until WiFi returns")
                return
            }
            val uploadId = "${deviceId}_${System.currentTimeMillis()}_${allKeys.size}"
            val json = JSONObject(scan.mapValues { it.value.toString() }).toString()
            prefs.edit().putString(uploadId, json).apply()
            android.util.Log.d("OfflineQueue", "Saved scan $uploadId (${json.length} bytes)")
        } catch (e: Exception) {
            android.util.Log.e("OfflineQueue", "Save failed: ${e.message}")
        }
    }

    private fun flushOfflineQueue() {
        val prefs = getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
        val allEntries = prefs.all.toMap()
        if (allEntries.isEmpty()) return
        android.util.Log.d("OfflineQueue", "Flushing ${allEntries.size} offline scans")

        val hId = homeId ?: return
        val db  = FirebaseFirestore.getInstance()
        val BATCH_SIZE = 500
        val entries = allEntries.entries.toList()

        for (i in entries.indices step BATCH_SIZE) {
            val batch = db.batch()
            val chunk = entries.subList(i, minOf(i + BATCH_SIZE, entries.size))
            var success = true
            for ((uploadId, value) in chunk) {
                try {
                    val json   = JSONObject(value as String)
                    val docRef = db.collection("homes").document(hId)
                        .collection("scans").document(uploadId)
                    val data   = mutableMapOf<String, Any>("upload_id" to uploadId)
                    json.keys().forEach { k -> data[k] = json.getString(k) }
                    batch.set(docRef, data)
                } catch (e: Exception) {
                    android.util.Log.e("OfflineQueue", "Parse error for $uploadId: ${e.message}")
                    success = false
                }
            }
            batch.commit()
                .addOnSuccessListener {
                    val editor = prefs.edit()
                    chunk.forEach { (k, _) -> editor.remove(k) }
                    editor.apply()
                    android.util.Log.d("OfflineQueue", "Uploaded ${chunk.size} scans")
                }
                .addOnFailureListener { e ->
                    android.util.Log.e("OfflineQueue", "Batch upload failed: ${e.message}")
                }
        }
    }

    // ─── Ping כל שנייה ────────────────────────────────────
    private fun doPing() {
        val wifi = currentWifi ?: return
        if (wifi.gateway.isEmpty() || wifi.gateway == "0.0.0.0") return
        val gwMs  = pingHost(wifi.gateway)
        val netMs = pingHost("8.8.8.8")
        if (gwMs >= 0 || netMs >= 0) {
            pingBuffer.add(PingReading(gwMs, netMs))
            // שמור רק 60 readings אחרונים (דקה)
            while (pingBuffer.size > 60) pingBuffer.removeAt(0)
        }
    }

    // ─── WiFi scan כל 30 שניות ────────────────────────────
    private fun doWifiScan() {
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

            // WiFi info — Android 12+ דרך NetworkCallback, ישן דרך connectionInfo
            @Suppress("DEPRECATION")
            val wifiInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                activeWifiInfo ?: wm.connectionInfo
            } else {
                wm.connectionInfo
            }

            val ssid  = wifiInfo?.ssid?.replace("\"", "") ?: ""
            val bssid = wifiInfo?.bssid ?: ""
            val rssi  = wifiInfo?.rssi ?: -100
            val freq  = wifiInfo?.frequency ?: 0

            // TX/RX — Link Speed מ-wifiInfo
            @Suppress("DEPRECATION")
            val txSpeed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                wifiInfo?.txLinkSpeedMbps ?: 0
            else
                wifiInfo?.linkSpeed ?: 0
            @Suppress("DEPRECATION")
            val rxSpeed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                wifiInfo?.rxLinkSpeedMbps ?: 0
            else
                wifiInfo?.linkSpeed ?: 0

            // IP
            @Suppress("DEPRECATION")
            val ipInt = wifiInfo?.ipAddress ?: 0
            val ip = String.format("%d.%d.%d.%d",
                ipInt and 0xff, ipInt shr 8 and 0xff,
                ipInt shr 16 and 0xff, ipInt shr 24 and 0xff)

            // Gateway + DNS
            @Suppress("DEPRECATION")
            val dhcp = wm.dhcpInfo
            val gateway = Formatter.formatIpAddress(dhcp?.gateway ?: 0)
            val dns1    = Formatter.formatIpAddress(dhcp?.dns1 ?: 0)
            val dns2    = Formatter.formatIpAddress(dhcp?.dns2 ?: 0)

            val channel = frequencyToChannel(freq)
            val band = when {
                freq in 2400..2499 -> "2.4 GHz"
                freq in 4900..5899 -> "5 GHz"
                freq >= 5900       -> "6 GHz"
                else               -> "Unknown"
            }

            val snapshot = WifiSnapshot(ssid, bssid, rssi, freq, ip, txSpeed, rxSpeed, gateway, dns1, dns2, channel, band)
            currentWifi = snapshot

            // Roaming + Band Steering
            checkRoaming(bssid, band, rssi)

            // Nearby networks
            val now = System.currentTimeMillis()
            if (lastNearbyScan == 0L || now - lastNearbyScan > NEARBY_INTERVAL_MS) {
                lastNearbyScan = now
                @Suppress("DEPRECATION")
                val scanResults = wm.scanResults ?: emptyList()
                lastNearbyNetworks = scanResults.take(50).map { r ->
                    hashMapOf(
                        "ssid"    to (r.SSID ?: ""),
                        "bssid"   to (r.BSSID ?: ""),
                        "rssi"    to r.level,
                        "channel" to frequencyToChannel(r.frequency),
                        "band"    to when {
                            r.frequency in 2400..2499 -> "2.4 GHz"
                            r.frequency in 4900..5899 -> "5 GHz"
                            r.frequency >= 5900       -> "6 GHz"
                            else -> "Unknown"
                        }
                    )
                }
            }

            // Battery
            if (lastBatteryScan == 0L || now - lastBatteryScan > BATTERY_INTERVAL_MS) {
                lastBatteryScan = now
                val bm = applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                currentBattery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            }

            // Public IP
            if (lastPublicIpCheck == 0L || now - lastPublicIpCheck > PUBLIC_IP_INTERVAL_MS) {
                lastPublicIpCheck = now
                Thread { fetchPublicIp() }.start()
            }

            android.util.Log.d("NativeScan", "WiFi: $ssid rssi=$rssi tx=$txSpeed rx=$rxSpeed")

        } catch (e: Exception) {
            android.util.Log.w("NativeScan", "WiFi scan error: ${e.message}")
        }
    }

    // ─── Roaming + Band Steering detection ────────────────
    private fun checkRoaming(bssid: String, band: String, rssi: Int) {
        val hId = homeId   ?: return
        val dId = deviceId ?: return
        if (bssid.isEmpty() || bssid == "02:00:00:00:00:00") return

        if (lastBssid != null && lastBssid != bssid && rssi > -120) {
            android.util.Log.d("NativeScan", "ROAMING: $lastBssid → $bssid")
            logEvent(hId, dId, "roaming", hashMapOf(
                "from_bssid" to (lastBssid ?: ""),
                "to_bssid"   to bssid,
                "rssi"       to rssi,
            ))
        }

        if (lastBand != null && lastBand != band && band != "Unknown") {
            android.util.Log.d("NativeScan", "BAND STEERING: $lastBand → $band")
            logEvent(hId, dId, "band_steering", hashMapOf(
                "from_band" to (lastBand ?: ""),
                "to_band"   to band,
                "bssid"     to bssid,
            ))
        }

        if (rssi > -120) {
            lastBssid = bssid
            lastBand  = band
        }
    }

    // ─── Upload כל 30 שניות ───────────────────────────────
    private fun doUpload(force: Boolean = false) {
        val hId  = homeId   ?: return
        val dId  = deviceId ?: return
        val wifi = currentWifi ?: return

        // Save RSSI/SSID/BSSID for disconnect event
        lastRssi  = wifi.rssi
        lastSsid  = wifi.ssid
        lastBssid = wifi.bssid

        // If in outage — save locally
        if (isInOutage) {
            android.util.Log.d("doUpload", "In outage — saving to offline queue")
            // will be saved after scan is built
        }

        // ממוצע pings
        val readings = pingBuffer.toList()
        val gwReadings  = readings.filter { it.gatewayMs >= 0 }.map { it.gatewayMs }
        val netReadings = readings.filter { it.internetMs >= 0 }.map { it.internetMs }

        val gwLatency  = if (gwReadings.isEmpty())  -1 else gwReadings.average().toInt()
        val gwJitter   = if (gwReadings.size < 2)    0 else calculateJitter(gwReadings)
        val gwLoss     = if (readings.isEmpty())    100 else
            ((readings.count { it.gatewayMs < 0 } * 100) / readings.size)

        val netLatency = if (netReadings.isEmpty()) -1 else netReadings.average().toInt()
        val netLoss    = if (readings.isEmpty())   100 else
            ((readings.count { it.internetMs < 0 } * 100) / readings.size)

        // נקה buffer אחרי upload
        pingBuffer.clear()

        // Signal score
        val rssi = wifi.rssi
        val signalScore = when {
            rssi >= -50 -> "Excellent"
            rssi >= -60 -> "Good"
            rssi >= -70 -> "Fair"
            else        -> "Poor"
        }

        val distance = 10.0.pow((-69 - rssi) / 20.0)

        // Channel congestion
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val scanResults = wm.scanResults ?: emptyList()
        val congestion = scanResults.count { frequencyToChannel(it.frequency) == wifi.channel }

        // Connectivity
        val cm   = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val isWifi     = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

        val scan = hashMapOf<String, Any>(
            "device_id"    to dId,
            "timestamp"    to FieldValue.serverTimestamp(),
            "battery_level" to currentBattery,
            "public_ip"    to (currentPublicIp ?: ""),
            "screen_state" to currentScreenState,
            "app_state"    to currentAppState,
            "wifi" to hashMapOf(
                "ssid"               to wifi.ssid,
                "bssid"              to wifi.bssid,
                "rssi"               to rssi,
                "frequency"          to wifi.freq,
                "channel"            to wifi.channel,
                "band"               to wifi.band,
                "ip"                 to wifi.ip,
                "tx_speed"           to wifi.txSpeed,
                "rx_speed"           to wifi.rxSpeed,
                "signal_score"       to signalScore,
                "distance_m"         to String.format("%.1f", distance),
                "is_wifi"            to isWifi,
                "has_internet"       to hasInternet,
                "channel_congestion" to congestion,
            ),
            "network" to hashMapOf(
                "gateway" to wifi.gateway,
                "dns1"    to wifi.dns1,
                "dns2"    to wifi.dns2,
            ),
            "ping" to hashMapOf(
                "gateway" to hashMapOf(
                    "host"       to wifi.gateway,
                    "latency"    to gwLatency,
                    "jitter"     to gwJitter,
                    "packetLoss" to gwLoss,
                    "samples"    to readings.size,
                ),
                "internet" to hashMapOf(
                    "host"       to "8.8.8.8",
                    "latency"    to netLatency,
                    "packetLoss" to netLoss,
                    "samples"    to readings.size,
                )
            ),
            "nearby_networks" to lastNearbyNetworks,
        )

        uploadScan(hId, scan)

        val gwText  = if (gwLatency >= 0)  "${gwLatency}ms"  else "—"
        val netText = if (netLatency >= 0) "${netLatency}ms" else "—"
        updateNotification("RSSI: $rssi dBm ($signalScore) · GW: $gwText · Net: $netText · ${readings.size} pings")
        android.util.Log.d("NativeScan", "Upload: rssi=$rssi gw=$gwLatency net=$netLatency samples=${readings.size}")
    }

    // ─── LAN scan כל 15 דקות ──────────────────────────────
    private fun doLanScan() {
        val hId  = homeId   ?: return
        val dId  = deviceId ?: return
        val wifi = currentWifi ?: return
        if (wifi.ip.isEmpty() || wifi.ip == "0.0.0.0") return

        try {
            val devices = LanScanner.scan(applicationContext, wifi.ip)
            if (devices.isEmpty()) return

            val devList = devices.map { d ->
                hashMapOf("ip" to d.ip, "mac" to d.mac, "hostname" to d.hostname)
            }

            FirebaseFirestore.getInstance()
                .collection("homes").document(hId)
                .collection("lan_scans").add(hashMapOf(
                    "device_id" to dId,
                    "timestamp" to FieldValue.serverTimestamp(),
                    "devices"   to devList,
                    "count"     to devList.size,
                ))
                .addOnSuccessListener {
                    android.util.Log.d("NativeScan", "LAN scan uploaded: ${devices.size} devices")
                }
                .addOnFailureListener {
                    android.util.Log.w("NativeScan", "LAN scan upload failed: ${it.message}")
                }
        } catch (e: Exception) {
            android.util.Log.w("NativeScan", "LAN scan error: ${e.message}")
        }
    }

    // ─── Public IP ────────────────────────────────────────
    private fun fetchPublicIp() {
        try {
            val ip = URL("https://api.ipify.org").readText().trim()
            if (currentPublicIp != null && currentPublicIp != ip) {
                val hId = homeId ?: return
                val dId = deviceId ?: return
                logEvent(hId, dId, "ip_change", hashMapOf(
                    "old_ip" to (currentPublicIp ?: ""),
                    "new_ip" to ip,
                ))
            }
            lastPublicIp   = currentPublicIp
            currentPublicIp = ip
        } catch (_: Exception) {}
    }

    // ─── Upload + Retry ───────────────────────────────────
    private fun uploadScan(hId: String, scan: Map<String, Any>) {
        FirebaseFirestore.getInstance()
            .collection("homes").document(hId)
            .collection("scans").add(scan)
            .addOnSuccessListener { android.util.Log.d("NativeScan", "Upload OK: ${it.id}") }
            .addOnFailureListener {
                android.util.Log.w("NativeScan", "Upload failed: ${it.message}")
                val toSave = scan.toMutableMap().apply { put("_homeId", hId) }
                if (retryQueue.size < MAX_RETRY) { retryQueue.offer(toSave); saveRetryQueue() }
            }
    }

    private fun logEvent(hId: String, dId: String, type: String, data: Map<String, Any>) {
        val event = hashMapOf<String, Any>(
            "device_id" to dId,
            "type"      to type,
            "timestamp" to FieldValue.serverTimestamp(),
        ) + data
        FirebaseFirestore.getInstance()
            .collection("homes").document(hId)
            .collection("events").add(event)
            .addOnFailureListener { android.util.Log.w("NativeScan", "logEvent failed: ${it.message}") }
    }

    private fun flushRetryQueue() {
        if (retryQueue.isEmpty()) return
        val db = FirebaseFirestore.getInstance()
        val toRetry = mutableListOf<Map<String, Any>>()
        retryQueue.drainTo(toRetry)
        toRetry.forEach { scan ->
            val hId = scan["_homeId"] as? String ?: return@forEach
            db.collection("homes").document(hId)
                .collection("scans").add(scan.filter { it.key != "_homeId" })
                .addOnSuccessListener { saveRetryQueue() }
                .addOnFailureListener { if (retryQueue.size < MAX_RETRY) { retryQueue.offer(scan); saveRetryQueue() } }
        }
    }

    // ─── Ping ─────────────────────────────────────────────
    private fun pingHost(host: String): Int {
        return try {
            val start = System.currentTimeMillis()
            Socket().use { it.connect(InetSocketAddress(host, 80), 1000) }
            (System.currentTimeMillis() - start).toInt()
        } catch (_: Exception) {
            try {
                val start = System.currentTimeMillis()
                if (InetAddress.getByName(host).isReachable(1000))
                    (System.currentTimeMillis() - start).toInt() else -1
            } catch (_: Exception) { -1 }
        }
    }

    private fun calculateJitter(latencies: List<Int>): Int {
        if (latencies.size < 2) return 0
        var total = 0
        for (i in 1 until latencies.size) total += abs(latencies[i] - latencies[i - 1])
        return total / (latencies.size - 1)
    }

    // ─── Notification ──────────────────────────────────────
    private fun startForegroundNotification(text: String = "Scanning WiFi...") {
        val channelId = "wifi_monitor_native"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(channelId, "WiFi Monitor", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
        val notif = buildNotif(channelId, text)

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            startForeground(1338, notif)
            return
        }

        // Android 14+: location type is not allowed when started from background (e.g. BOOT_COMPLETED)
        // without ACCESS_BACKGROUND_LOCATION, and Android 15+ bans some types from boot entirely.
        // Try the richest allowed combination first, fall back instead of crashing.
        val cd  = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        val loc = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        val hasLocation = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val candidates = if (hasLocation) intArrayOf(cd or loc, cd) else intArrayOf(cd)
        for (type in candidates) {
            try {
                startForeground(1338, notif, type)
                return
            } catch (e: Exception) {
                android.util.Log.w("NativeScan", "startForeground type=$type failed: ${e.message}")
            }
        }
        android.util.Log.w("NativeScan", "startForeground refused — stopping service")
        stopSelf()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(1338, buildNotif("wifi_monitor_native", text))
    }

    private fun buildNotif(channelId: String, text: String) =
        NotificationCompat.Builder(this, channelId)
            .setContentTitle("WiFi Monitor Plus")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

    // ─── Helpers ───────────────────────────────────────────
    private fun frequencyToChannel(freq: Int): Int {
        if (freq == 2484) return 14
        if (freq in 2412..2484) return (freq - 2407) / 5
        if (freq in 5000..5885) return (freq - 5000) / 5
        return 0
    }

    // ─── SharedPreferences ────────────────────────────────
    private fun saveRetryQueue() {
        try {
            val arr = JSONArray()
            retryQueue.forEach { scan ->
                val obj = JSONObject()
                scan.forEach { (k, v) -> obj.put(k, v.toString()) }
                arr.put(obj)
            }
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(RETRY_KEY, arr.toString()).apply()
        } catch (_: Exception) {}
    }

    private fun loadRetryQueue() {
        try {
            val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(RETRY_KEY, null) ?: return
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val map = mutableMapOf<String, Any>()
                obj.keys().forEach { k -> map[k] = obj.getString(k) }
                if (retryQueue.size < MAX_RETRY) retryQueue.offer(map)
            }
        } catch (_: Exception) {}
    }

    private fun loadPref(key: String) =
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(key, null)

    private fun savePref(key: String, value: String) =
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(key, value).apply()
}