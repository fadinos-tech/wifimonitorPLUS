package com.clicksolution.wifimonitor

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.io.File
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class LanDevice(
    val ip:       String,
    var mac:      String = "—",
    var hostname: String = "—"
)

object LanScanner {

    fun scan(context: Context, deviceIp: String): List<LanDevice> {
        val subnet = deviceIp.split(".").take(3).joinToString(".")
        android.util.Log.d("LanScanner", "Scanning $subnet.0/24")

        val found = CopyOnWriteArrayList<LanDevice>()
        val pool  = Executors.newFixedThreadPool(50)

        // ── Step 1: Ping all hosts ────────────────────────
        for (i in 1..254) {
            val ip = "$subnet.$i"
            pool.submit {
                try {
                    val addr = InetAddress.getByName(ip)
                    if (addr.isReachable(500)) {
                        val device = LanDevice(ip = ip)
                        try {
                            val name = addr.canonicalHostName
                            if (name != ip) device.hostname = name
                        } catch (_: Exception) {}
                        found.add(device)
                    }
                } catch (_: Exception) {}
            }
        }

        pool.shutdown()
        pool.awaitTermination(10, TimeUnit.SECONDS)

        // ── Step 2: Read /proc/net/arp for MACs ───────────
        try {
            val arpLines = File("/proc/net/arp").readText().trim().split("\n").drop(1)
            for (line in arpLines) {
                val parts = line.trim().split(Regex("\\s+"))
                if (parts.size < 4) continue
                val ip    = parts[0]
                val flags = parts[2]
                val mac   = parts[3]
                if (mac == "00:00:00:00:00:00" || ip == "0.0.0.0" || flags == "0x0") continue
                found.find { it.ip == ip }?.mac = mac
            }
        } catch (e: Exception) {
            android.util.Log.w("LanScanner", "ARP read failed: ${e.message}")
        }

        // ── Step 3: mDNS discovery ────────────────────────
        val mdnsNames = mutableMapOf<String, String>()
        try {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            val latch = CountDownLatch(1)

            val listener = object : NsdManager.DiscoveryListener {
                override fun onStartDiscoveryFailed(s: String, e: Int) { latch.countDown() }
                override fun onStopDiscoveryFailed(s: String, e: Int) {}
                override fun onDiscoveryStarted(s: String) {}
                override fun onDiscoveryStopped(s: String) {}
                override fun onServiceFound(info: NsdServiceInfo) {
                    nsdManager.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(i: NsdServiceInfo, e: Int) {}
                        override fun onServiceResolved(i: NsdServiceInfo) {
                            val ip   = i.host?.hostAddress ?: return
                            val name = i.serviceName ?: return
                            mdnsNames[ip] = name
                        }
                    })
                }
                override fun onServiceLost(info: NsdServiceInfo) {}
            }

            nsdManager.discoverServices("_services._dns-sd._udp", NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(3, TimeUnit.SECONDS)
            try { nsdManager.stopServiceDiscovery(listener) } catch (_: Exception) {}
        } catch (e: Exception) {
            android.util.Log.w("LanScanner", "mDNS failed: ${e.message}")
        }

        // Apply mDNS names
        found.forEach { device -> mdnsNames[device.ip]?.let { device.hostname = it } }

        val result = found.sortedBy { it.ip.split(".").last().toIntOrNull() ?: 0 }
        android.util.Log.d("LanScanner", "Scan complete: ${result.size} devices")
        return result
    }
}
