import WifiManager from "react-native-wifi-reborn";
import { PermissionsAndroid, Platform, NativeModules } from "react-native";

// ─── בקש הרשאות ───────────────────────────────────────────
export async function requestWifiPermissions() {
  if (Platform.OS !== "android") return false;

  try {
    const permissions = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];

    // אנדרואיד 13+ דורש NEARBY_WIFI_DEVICES
    if (Platform.Version >= 33) {
      permissions.push("android.permission.NEARBY_WIFI_DEVICES");
    }

    const granted = await PermissionsAndroid.requestMultiple(permissions);
    console.log("Permissions result:", JSON.stringify(granted));

    const locationGranted =
      granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === "granted" ||
      granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === "granted";

    return locationGranted;
  } catch (err) {
    console.warn("Permission error:", err);
    return false;
  }
}

// ─── סריקת WiFi ───────────────────────────────────────────
export async function scanWifi() {
  try {
    console.log("Starting WiFi scan...");

    // קבל מידע על הרשת הנוכחית
    const current = await getCurrentWifi();
    console.log("Current WiFi:", JSON.stringify(current));

    // נסה לסרוק רשתות בסביבה
    let networks = [];
    try {
      networks = await WifiManager.loadWifiList();
      console.log("Nearby networks count:", networks?.length);
    } catch (scanErr) {
      console.warn("Network scan error (expected on some devices):", scanErr.message);
    }

    return {
      timestamp: Date.now(),
      current,
      networks: (networks || []).map((n) => ({
        ssid:      n.SSID      || "",
        bssid:     n.BSSID     || "",
        rssi:      n.level     || 0,
        frequency: n.frequency || 0,
        channel:   frequencyToChannel(n.frequency),
        band:      frequencyToBand(n.frequency),
        security:  n.capabilities || "",
      })),
    };
  } catch (err) {
    console.warn("WiFi scan error:", err);
    return null;
  }
}

// ─── קרא TX/RX מ-/proc/net/dev ───────────────────────────
let lastRxBytes = 0;
let lastTxBytes = 0;
let lastSpeedTime = 0;

async function getWifiSpeed() {
  try {
    const { RNFS } = require("react-native-fs");
    const content = await RNFS.readFile("/proc/net/dev", "utf8");
    const lines = content.split("\n");
    // חפש wlan0 או wlan1
    const wlanLine = lines.find(l => l.trim().startsWith("wlan"));
    if (!wlanLine) return { tx_speed: null, rx_speed: null };

    const parts = wlanLine.trim().split(/\s+/);
    const rxBytes = parseInt(parts[1]) || 0; // bytes received
    const txBytes = parseInt(parts[9]) || 0; // bytes transmitted

    const now = Date.now();
    const elapsed = (now - lastSpeedTime) / 1000; // seconds

    let tx_speed = null;
    let rx_speed = null;

    if (lastSpeedTime > 0 && elapsed > 0 && elapsed < 60) {
      rx_speed = Math.round(((rxBytes - lastRxBytes) * 8) / elapsed / 1_000_000); // Mbps
      tx_speed = Math.round(((txBytes - lastTxBytes) * 8) / elapsed / 1_000_000); // Mbps
      rx_speed = Math.max(0, rx_speed);
      tx_speed = Math.max(0, tx_speed);
    }

    lastRxBytes = rxBytes;
    lastTxBytes = txBytes;
    lastSpeedTime = now;

    return { tx_speed, rx_speed };
  } catch {
    return { tx_speed: null, rx_speed: null };
  }
}

// ─── מידע על הרשת הנוכחית ─────────────────────────────────
export async function getCurrentWifi() {
  try {
    const results = await Promise.allSettled([
      WifiManager.getCurrentWifiSSID(),
      WifiManager.getBSSID(),
      WifiManager.getCurrentSignalStrength(),
      WifiManager.getFrequency(),
      WifiManager.getIP(),
    ]);

    const ssid      = results[0].status === "fulfilled" ? results[0].value : "";
    const bssid     = results[1].status === "fulfilled" ? results[1].value : "";
    const rssi      = results[2].status === "fulfilled" ? results[2].value : 0;
    const frequency = results[3].status === "fulfilled" ? results[3].value : 0;
    const ip        = results[4].status === "fulfilled" ? results[4].value : "";

    // קרא TX/RX speed
    const { tx_speed, rx_speed } = await getWifiSpeed();

    console.log("WiFi data:", { ssid, bssid, rssi, frequency, ip, tx_speed, rx_speed });

    return {
      ssid,
      bssid,
      rssi,
      frequency,
      channel:  frequencyToChannel(frequency),
      band:     frequencyToBand(frequency),
      ip,
      tx_speed,
      rx_speed,
    };
  } catch (err) {
    console.warn("getCurrentWifi error:", err);
    return null;
  }
}

// ─── עזר: תדר → ערוץ ──────────────────────────────────────
export function frequencyToChannel(freq) {
  if (!freq) return 0;
  if (freq >= 2412 && freq <= 2484) return Math.round((freq - 2412) / 5) + 1;
  if (freq >= 5170 && freq <= 5825) return Math.round((freq - 5170) / 5) + 34;
  if (freq >= 5955 && freq <= 7115) return Math.round((freq - 5955) / 5) + 1;
  return 0;
}

// ─── עזר: תדר → Band ──────────────────────────────────────
export function frequencyToBand(freq) {
  if (!freq) return "Unknown";
  if (freq >= 2400 && freq < 2500) return "2.4 GHz";
  if (freq >= 5000 && freq < 5900) return "5 GHz";
  if (freq >= 5900 && freq < 7200) return "6 GHz";
  return "Unknown";
}