import { NativeModules } from "react-native";

const { ArpModule } = NativeModules;

// ─── LAN Scanner — native ping + ARP ─────────────────────
// ArpModule.scanLan() does everything natively:
// 1. Pings all 254 hosts via InetAddress.isReachable() (has permission)
// 2. Reads /proc/net/arp after ARP cache is populated
// Returns only devices with valid MAC addresses.

export async function scanLanDevices(deviceIp) {
  try {
    if (!deviceIp) {
      console.warn("LAN scan: no device IP provided");
      return [];
    }

    if (!ArpModule) {
      console.warn("LAN scan: ArpModule not available");
      return [];
    }

    console.log("LAN scan: starting native scan for", deviceIp);
    const devices = await ArpModule.scanLan(deviceIp);
    console.log("LAN devices found:", devices.length);
    return devices;

  } catch (err) {
    console.warn("LAN scan error:", err.message);
    return [];
  }
}