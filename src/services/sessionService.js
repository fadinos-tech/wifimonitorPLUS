import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const SESSION_KEY = "wifimonitor_session";

// ─── Save session ─────────────────────────────────────────
export async function saveSession({ homeId, deviceId, deviceName, inviteCode, ssid }) {
  try {
    const session = { homeId, deviceId, deviceName, inviteCode: inviteCode || "", ssid: ssid || "" };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn("saveSession error:", err);
  }
}

// ─── Update invite code in session ────────────────────────
export async function saveInviteCode(inviteCode) {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    session.inviteCode = inviteCode;
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn("saveInviteCode error:", err);
  }
}

// ─── Get session ──────────────────────────────────────────
export async function getSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Clear session ────────────────────────────────────────
export async function clearSession() {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {}
}

// ─── Get device info ──────────────────────────────────────
export async function getDeviceInfo() {
  try {
    const DeviceInfo = require("react-native-device-info").default;
    const model         = await DeviceInfo.getModel();
    const brand         = await DeviceInfo.getBrand();
    const systemVersion = await DeviceInfo.getSystemVersion();
    const appVersion    = await DeviceInfo.getVersion();

    return {
      model:       `${brand} ${model}`,
      os:          `Android ${systemVersion}`,
      app_version: appVersion,
      platform:    Platform.OS,
    };
  } catch {
    return {
      model:       "Unknown",
      os:          Platform.OS,
      app_version: require("../../app.json").expo.version,
      platform:    Platform.OS,
    };
  }
}