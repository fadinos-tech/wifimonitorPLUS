import firestore from "@react-native-firebase/firestore";
import { getDeviceInfo } from "./sessionService";

// ─── Upload Scan ───────────────────────────────────────────
export async function uploadScan({
  homeId, deviceId, wifiData, pingData,
  includeNearby = false, batteryLevel = null, publicIp = null,
  screenState = null, appState = null,
  offlineTimestamp = null,
}) {
  try {
    console.log("=== UPLOAD START ===");
    console.log("HomeId:", homeId, "DeviceId:", deviceId);
    console.log("Battery:", batteryLevel, "IP:", publicIp);
    if (offlineTimestamp) console.log("Offline scan, timestamp:", offlineTimestamp);

    const deviceInfo = await getDeviceInfo();
    const current  = wifiData?.current || {};
    const networks = wifiData?.networks || [];

    const currentChannel    = current.channel || 0;
    const channelCongestion = currentChannel > 0
      ? networks.filter(n => n.channel === currentChannel).length
      : 0;

    const rssi = current.rssi || -100;
    const distanceM = rssi > -50 ? "~0.0m"
      : rssi > -60 ? "~5m"
      : rssi > -70 ? "~15m"
      : rssi > -80 ? "~30m" : ">50m";

    const gatewayPing = pingData?.gateway?.latency || null;
    let signalScore = "Poor";
    if (rssi > -50 && (gatewayPing || 999) < 20)  signalScore = "Excellent";
    else if (rssi > -60 && (gatewayPing || 999) < 50)  signalScore = "Good";
    else if (rssi > -70 && (gatewayPing || 999) < 100) signalScore = "Fair";

    // timestamp: serverTimestamp when online, a local Timestamp when offline
    const timestamp = offlineTimestamp
      ? firestore.Timestamp.fromDate(new Date(offlineTimestamp))
      : firestore.FieldValue.serverTimestamp();

    const scan = {
      device_id:     deviceId,
      device_info:   deviceInfo,
      timestamp,
      battery_level: batteryLevel,
      public_ip:     publicIp,
      screen_state:  screenState,
      app_state:     appState,
      wifi: {
        ssid:               current.ssid      || "",
        bssid:              current.bssid     || "",
        rssi:               current.rssi      || 0,
        frequency:          current.frequency || 0,
        channel:            current.channel   || 0,
        band:               current.band      || "",
        ip:                 current.ip        || "",
        tx_speed:           current.tx_speed  || null,
        rx_speed:           current.rx_speed  || null,
        channel_congestion: channelCongestion,
        distance_m:         distanceM,
        signal_score:       signalScore,
        has_internet:       !!(pingData?.internet?.latency || pingData?.["DNS Primary"]?.latency),
        is_wifi:            true,
      },
      ping: {
        gateway:  pingData?.gateway  || null,
        internet: pingData?.internet || pingData?.["DNS Primary"] || null,
      },
    };

    if (includeNearby && wifiData?.networks?.length > 0) {
      scan.nearby_networks = wifiData.networks.map((n) => ({
        ssid:    n.ssid,
        bssid:   n.bssid,
        rssi:    n.rssi,
        channel: n.channel,
        band:    n.band,
      }));
    }

    const ref = await firestore()
      .collection("homes")
      .doc(homeId)
      .collection("scans")
      .add(scan);

    console.log("Document written! ID:", ref.id);
    console.log("=== UPLOAD OK ===");
    return true;
  } catch (err) {
    console.warn("=== UPLOAD ERROR ===", err.message, err.code);
    if (
      err.code === "permission-denied" || err.code === "not-found" ||
      err.message?.includes("No document to update") ||
      err.message?.includes("does not exist")
    ) {
      return "INVALID_HOME";
    }
    return false;
  }
}

// ─── Log Event ────────────────────────────────────────────
export async function logEvent({ homeId, deviceId, type, ...data }) {
  try {
    await firestore()
      .collection("homes")
      .doc(homeId)
      .collection("events")
      .add({
        device_id: deviceId,
        type,
        timestamp: firestore.FieldValue.serverTimestamp(),
        ...data,
      });
    console.log(`Event logged: ${type}`);
    return true;
  } catch (err) {
    console.warn("logEvent error:", err);
    return false;
  }
}

// ─── Get or Create Home ────────────────────────────────────
export async function getOrCreateHome({ inviteCode, bssid, deviceId, deviceInfo }) {
  try {
    if (inviteCode) {
      const snap = await firestore()
        .collection("homes")
        .where("invite_code", "==", inviteCode)
        .limit(1)
        .get();
      if (!snap.empty) {
        const homeId = snap.docs[0].id;
        await firestore().collection("homes").doc(homeId).update({
          members:                 firestore.FieldValue.arrayUnion(deviceId),
          bssids:                  firestore.FieldValue.arrayUnion(bssid || ""),
          [`devices.${deviceId}`]: deviceInfo || {},
        });
        return homeId;
      }
    }

    if (bssid) {
      const snap = await firestore()
        .collection("homes")
        .where("bssids", "array-contains", bssid)
        .limit(1)
        .get();
      if (!snap.empty) {
        const homeId = snap.docs[0].id;
        await firestore().collection("homes").doc(homeId).update({
          members:                 firestore.FieldValue.arrayUnion(deviceId),
          [`devices.${deviceId}`]: deviceInfo || {},
        });
        return homeId;
      }
    }

    // Query succeeded but no home matches this code.
    return null;
  } catch (err) {
    // Do not swallow this: a permission or network failure is NOT the same as
    // a wrong code, and reporting both as "code not found" hides real problems.
    console.warn("getOrCreateHome error:", err?.code, err?.message);
    const e = new Error(err?.message || "lookup failed");
    e.code = err?.code || "unknown";
    throw e;
  }
}

// ─── Create Home ───────────────────────────────────────────
export async function createHome({ deviceId, bssid, homeName, deviceInfo }) {
  try {
    const inviteCode = generateCode();
    const ref = await firestore().collection("homes").add({
      name:        homeName || "My Home",
      invite_code: inviteCode,
      members:     [deviceId],
      bssids:      bssid ? [bssid] : [],
      devices:     { [deviceId]: deviceInfo || {} },
      created_at:  new Date().toISOString(),
    });
    console.log("Home created:", ref.id);
    return { homeId: ref.id, inviteCode };
  } catch (err) {
    console.warn("createHome error:", err.message);
    return null;
  }
}

// ─── Get invite code ──────────────────────────────────────
export async function getInviteCode(homeId) {
  try {
    const snap = await firestore().collection("homes").doc(homeId).get();
    return snap.data()?.invite_code || null;
  } catch {
    return null;
  }
}

// ─── Delete my scans ──────────────────────────────────────
export async function deleteMyScans(homeId, deviceId) {
  try {
    const snap = await firestore()
      .collection("homes")
      .doc(homeId)
      .collection("scans")
      .where("device_id", "==", deviceId)
      .get();
    const batch = firestore().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return true;
  } catch (err) {
    console.warn("deleteMyScans error:", err);
    return false;
  }
}

// ─── Generate Invite Code ─────────────────────────────────
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Upload LAN Devices ───────────────────────────────────
export async function uploadLanDevices({ homeId, deviceId, devices }) {
  try {
    await firestore()
      .collection("homes")
      .doc(homeId)
      .collection("lan_scans")
      .add({
        device_id: deviceId,
        timestamp: firestore.FieldValue.serverTimestamp(),
        devices,
        count: devices.length,
      });
    console.log("LAN devices uploaded:", devices.length);
    return true;
  } catch (err) {
    console.warn("uploadLanDevices error:", err.message);
    return false;
  }
}