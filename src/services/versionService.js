import firestore from "@react-native-firebase/firestore";
import { Platform } from "react-native";

// Remote config document: config/app
//   latest_version : "1.0.6"  — newest version published on the store
//   min_version    : "1.0.5"  — below this the update is mandatory and the app is blocked
//   update_url     : store link
//   message        : optional free text shown to the user
const CONFIG_PATH = { collection: "config", doc: "app" };

const DEFAULT_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.clicksolution.wifimonitor";

// ─── semver-style comparison ("1.0.10" > "1.0.9") ─────────
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export async function getCurrentVersion() {
  try {
    const DeviceInfo = require("react-native-device-info").default;
    return await DeviceInfo.getVersion();
  } catch {
    try {
      return require("../../app.json").expo.version;
    } catch {
      return "0.0.0";
    }
  }
}

// ─── Update check ─────────────────────────────────────────
// Always resolves to an object. On any failure the status is "ok" so that a
// network or config problem never locks the user out of the app.
export async function checkForUpdate() {
  const current = await getCurrentVersion();
  const none = { status: "ok", current };

  if (Platform.OS !== "android") return none;

  try {
    const snap = await firestore()
      .collection(CONFIG_PATH.collection)
      .doc(CONFIG_PATH.doc)
      .get();

    if (!snap.exists) return none;
    const cfg = snap.data() || {};

    const latest  = cfg.latest_version || null;
    const min     = cfg.min_version    || null;
    const url     = cfg.update_url     || DEFAULT_STORE_URL;
    const message = cfg.message || "";

    if (min && compareVersions(current, min) < 0) {
      return { status: "required", current, latest: latest || min, url, message };
    }
    if (latest && compareVersions(current, latest) < 0) {
      return { status: "optional", current, latest, url, message };
    }
    return none;
  } catch (err) {
    console.warn("checkForUpdate error:", err?.message);
    return none;
  }
}
