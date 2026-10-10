import * as Notifications from "expo-notifications";
import { AppState, NativeModules, DeviceEventEmitter } from "react-native";
import { getSession } from "./sessionService";

const { ForegroundServiceModule, ScreenStateModule } = NativeModules;

// ─── Notification setup ───────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge:  false,
  }),
});

async function dismissNotification() {
  try {
    await Notifications.dismissNotificationAsync("wifi-monitor-foreground");
  } catch {}
}

// ─── State ────────────────────────────────────────────────
let isRunning       = false;
let appStateSub     = null;
let screenStateSub  = null;
let currentInterval = 300;

// ─── Screen & App State ───────────────────────────────────
let currentScreenState = "on";
let currentAppState    = "foreground";

// ─── AppState listener ────────────────────────────────────
function setupAppStateListener() {
  appStateSub?.remove();
  appStateSub = AppState.addEventListener("change", (state) => {
    currentAppState = state === "active" ? "foreground" : "background";
    console.log("AppState:", currentAppState);
  });
}

// ─── Screen State listener ────────────────────────────────
function setupScreenStateListener() {
  ScreenStateModule?.getScreenState?.()
    .then((state) => { currentScreenState = state; })
    .catch(() => {});

  ScreenStateModule?.startListening?.();

  screenStateSub = DeviceEventEmitter.addListener("ScreenStateEvent", (event) => {
    console.log("ScreenStateEvent:", event);
    if (event === "SCREEN_OFF")   currentScreenState = "off";
    if (event === "SCREEN_ON")    currentScreenState = "on";
    if (event === "USER_PRESENT") currentScreenState = "on";
  });
}

function teardownScreenStateListener() {
  ScreenStateModule?.stopListening?.();
  screenStateSub?.remove();
  screenStateSub = null;
}

// ─── Public API ───────────────────────────────────────────
export async function startForegroundService(intervalSeconds = 300) {
  if (isRunning) return;
  isRunning = true;
  currentInterval = intervalSeconds;

  await Notifications.requestPermissionsAsync();

  const session  = await getSession();
  const homeId   = session?.homeId;
  const deviceId = session?.deviceId;

  if (!homeId || !deviceId) {
    console.warn("startForegroundService: no session");
    isRunning = false;
    return;
  }

  // The Kotlin service owns all scanning and uploading to Firebase
  ForegroundServiceModule?.start(homeId, deviceId, intervalSeconds);
  ForegroundServiceModule?.requestIgnoreBatteryOptimizations();

  setupAppStateListener();
  setupScreenStateListener();

  console.log("Foreground service started — Kotlin handles scanning every", intervalSeconds, "s");
}

export async function stopForegroundService() {
  isRunning = false;
  ForegroundServiceModule?.stop();
  appStateSub?.remove();
  appStateSub = null;
  teardownScreenStateListener();
  await dismissNotification();
  console.log("Foreground service stopped");
}

// Leaving a Home must also wipe the session stored on the native side,
// otherwise the service comes back on reboot and keeps uploading to the old home.
export async function clearNativeSession() {
  isRunning = false;
  appStateSub?.remove();
  appStateSub = null;
  teardownScreenStateListener();
  try {
    await ForegroundServiceModule?.clearSession();
  } catch (err) {
    console.warn("clearNativeSession error:", err);
  }
  await dismissNotification();
  console.log("Native session cleared");
}

export function isServiceRunning()      { return isRunning; }
export function getCurrentScreenState() { return currentScreenState; }
export function getCurrentAppState()    { return currentAppState; }

// ─── Manual upload — triggers an immediate scan via Kotlin ───
export async function manualUpload() {
  try {
    const result = await ForegroundServiceModule?.triggerUpload();
    return result;
  } catch (err) {
    console.warn("manualUpload error:", err);
    return false;
  }
}