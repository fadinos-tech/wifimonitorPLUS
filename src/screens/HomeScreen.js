import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, DrawerLayoutAndroid,
  Switch, TextInput, Share, ToastAndroid, Animated, I18nManager,
  DeviceEventEmitter,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import appConfig from "../config/appConfig";
import { requestWifiPermissions, getCurrentWifi } from "../services/wifiScanner";
import {
  startForegroundService,
  stopForegroundService,
  clearNativeSession,
  manualUpload,
} from "../services/foregroundService";
import { getInviteCode } from "../services/firebaseService";
import { clearSession, saveInviteCode } from "../services/sessionService";

const version = require("../../app.json").expo.version;

export default function HomeScreen({ homeId, deviceId, deviceName, inviteCode: savedCode, homeSsid, onLeave }) {
  const [status, setStatus]           = useState("idle");
  const [scanCount, setScanCount]     = useState(0);
  const [lastScan, setLastScan]       = useState(null);
  const [inviteCode, setInviteCode]   = useState(savedCode || "");
  const [uploading, setUploading]     = useState(false);
  const [wifiError, setWifiError]     = useState(null);

  const [scanInterval, setScanIntervalState]          = useState(appConfig.scanIntervalSeconds);
  const [pendingScanInterval, setPendingScanInterval] = useState(appConfig.scanIntervalSeconds);
  const [settingsSaved, setSettingsSaved]             = useState(false);
  const [uploadOnCellular, setUploadOnCellular]       = useState(appConfig.uploadOnCellular);
  const [dnsPrimary, setDnsPrimary]                   = useState(appConfig.pingTargets[0].host);
  const [dnsSecondary, setDnsSecondary]               = useState(appConfig.pingTargets[1].host);
  const [dnsSecondaryEnabled, setDnsSecondaryEnabled] = useState(appConfig.pingTargets[1].enabled);

  const drawerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const insets    = useSafeAreaInsets();

  // Force LTR regardless of device language
  useEffect(() => {
    if (I18nManager.isRTL) {
      I18nManager.forceRTL(false);
    }
  }, []);

  // Pulsing animation
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Listen for invalid home code
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("INVALID_HOME_CODE", () => {
      setStatus("idle");
      stopForegroundService();
      Alert.alert(
        "⚠️ Invalid Code",
        "The home code is no longer valid.\n\nPlease create a new code or contact your administrator.",
        [
          { text: "OK", style: "default" },
        ]
      );
    });
    return () => sub.remove();
  }, []);

  // Load invite code
  useEffect(() => {
    requestWifiPermissions();
    if (!savedCode) {
      getInviteCode(homeId)
        .then((code) => {
          if (code) {
            setInviteCode(code);
            saveInviteCode(code);
          }
        })
        .catch(() => {});
    }
  }, [homeId]);

  // Scan counter
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => {
      setScanCount((c) => c + 1);
      setLastScan(new Date());
    }, scanInterval * 1000);
    return () => clearInterval(t);
  }, [status, scanInterval]);

  async function handleStart() {
    setWifiError(null);

    // בדוק הרשאות
    const ok = await requestWifiPermissions();
    if (!ok) {
      Alert.alert("Permission Required", "Location permission is required.");
      return;
    }

    // בדוק שWiFi מחובר
    let wifi = null;
    try { wifi = await getCurrentWifi(); } catch {}

    if (!wifi?.ssid) {
      setWifiError("לא מחובר לרשת WiFi. אנא התחבר לרשת ולחץ שוב.");
      return;
    }

    // בדוק שה SSID תואם ל Home (אם homeSsid מוגדר)
    if (homeSsid && wifi.ssid !== homeSsid) {
      setWifiError(`מחובר לרשת "${wifi.ssid}" אך ה-Home מוגדר לרשת "${homeSsid}". אנא התחבר לרשת הנכונה.`);
      return;
    }

    setStatus("running");
    await startForegroundService(scanInterval);
  }

  async function handleStop() {
    setStatus("idle");
    await stopForegroundService();
    setScanCount(0);
    setLastScan(null);
  }

async function handleManualUpload() {
  if (status === "idle") {
    ToastAndroid.show("Start scanning first before uploading.", ToastAndroid.LONG);
    return;
  }
  setUploading(true);
  try {
    await manualUpload();
    setTimeout(() => {
      setUploading(false);
      ToastAndroid.show("Upload triggered!", ToastAndroid.SHORT);
    }, 1500);
  } catch (err) {
    setUploading(false);
    Alert.alert("Upload Failed", "Could not trigger upload. Is the service running?");
  }
}

  async function handleScanIntervalChange(val) {
    setPendingScanInterval(val);
  }

  async function handleSaveSettings() {
    setScanIntervalState(pendingScanInterval);
    appConfig.scanIntervalSeconds = pendingScanInterval;
    if (status === "running") {
      await stopForegroundService();
      await startForegroundService(pendingScanInterval);
    }
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  function handleShareCode() {
    Share.share({
      message: `Join my home on WiFi Monitor Plus!\n\nInvite Code: ${inviteCode}\n\nDownload the app and enter this code during setup.`,
    });
  }

  async function handleLeaveHome() {
    await handleStop();
    await clearNativeSession();
    await clearSession();
    onLeave();
  }


  const DrawerContent = () => (
    <View style={{ flex: 1, backgroundColor: "#0F172A", paddingBottom: insets.bottom, direction: "ltr" }}>
      <ScrollView>
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>{appConfig.appName}</Text>
          <Text style={styles.drawerSub}>v{version} · Settings</Text>
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerSectionTitle}>MY HOME</Text>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>Device Name</Text>
            <Text style={styles.drawerValue}>{deviceName || "—"}</Text>
          </View>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>Home ID</Text>
            <Text style={styles.drawerValue}>{homeId?.slice(0, 12)}...</Text>
          </View>
          <View style={styles.inviteCodeBox}>
            <Text style={styles.inviteCodeLabel}>HOME INVITE CODE</Text>
            <Text style={styles.inviteCode}>{inviteCode || "—"}</Text>
            <TouchableOpacity
              style={[styles.smallBtn, { backgroundColor: appConfig.primaryColor }]}
              onPress={handleShareCode}
            >
              <Text style={styles.smallBtnText}>Share Code</Text>
            </TouchableOpacity>
            <Text style={styles.inviteHint}>Share with other devices to join this home</Text>
          </View>
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerSectionTitle}>SCAN SETTINGS</Text>
          <Text style={styles.drawerLabel}>Scan Interval (min 20s)</Text>
          <View style={styles.chipRow}>
            {[20, 30, 60, 120].map((sec) => (
              <TouchableOpacity
                key={sec}
                style={[styles.chip, pendingScanInterval === sec && styles.chipActive]}
                onPress={() => handleScanIntervalChange(sec)}
              >
                <Text style={[styles.chipText, pendingScanInterval === sec && styles.chipTextActive]}>
                  {sec}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>Upload on Cellular</Text>
            <Switch
              value={uploadOnCellular}
              onValueChange={setUploadOnCellular}
              trackColor={{ false: "#334155", true: appConfig.primaryColor }}
              thumbColor="#fff"
            />
          </View>
          <TouchableOpacity
            style={[styles.drawerButton, { backgroundColor: settingsSaved ? "#16A34A" : appConfig.primaryColor, marginTop: 12 }]}
            onPress={handleSaveSettings}
          >
            <Text style={styles.drawerButtonText}>{settingsSaved ? "✓ Saved!" : "Save Settings"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerSectionTitle}>PING SETTINGS</Text>
          <Text style={styles.drawerLabel}>DNS Primary</Text>
          <TextInput
            style={styles.drawerInput}
            value={dnsPrimary}
            onChangeText={setDnsPrimary}
            keyboardType="numeric"
            placeholderTextColor="#475569"
          />
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>DNS Secondary</Text>
            <Switch
              value={dnsSecondaryEnabled}
              onValueChange={setDnsSecondaryEnabled}
              trackColor={{ false: "#334155", true: appConfig.primaryColor }}
              thumbColor="#fff"
            />
          </View>
          {dnsSecondaryEnabled && (
            <TextInput
              style={styles.drawerInput}
              value={dnsSecondary}
              onChangeText={setDnsSecondary}
              keyboardType="numeric"
              placeholderTextColor="#475569"
            />
          )}
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerSectionTitle}>ABOUT</Text>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>App</Text>
            <Text style={styles.drawerValue}>{appConfig.appName}</Text>
          </View>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>Version</Text>
            <Text style={styles.drawerValue}>v{version}</Text>
          </View>
        </View>

        <View style={[styles.drawerSection, { marginBottom: 16 }]}>
          <Text style={[styles.drawerSectionTitle, { color: "#DC2626" }]}>DANGER ZONE</Text>
          <TouchableOpacity
            style={[styles.drawerButton, { backgroundColor: "#DC2626", marginTop: 8 }]}
            onPress={() =>
              Alert.alert("Leave Home", "Are you sure?", [
                { text: "Cancel", style: "cancel" },
                { text: "Leave", style: "destructive", onPress: handleLeaveHome },
              ])
            }
          >
            <Text style={styles.drawerButtonText}>Leave Home</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  const dotColor = status === "running" ? "#16A34A" : "#64748B";

  return (
    <DrawerLayoutAndroid
      ref={drawerRef}
      drawerWidth={300}
      drawerPosition="left"
      renderNavigationView={() => <DrawerContent />}
    >
      <SafeAreaView style={styles.container}>

        {/* Header — always LTR, title left */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{appConfig.appName}</Text>
          <Text style={styles.headerSub}>
            {deviceName ? `${deviceName} · ` : ""}
            {scanCount > 0
              ? `Scans: ${scanCount} · Last: ${lastScan?.toLocaleTimeString()}`
              : "WiFi Intelligence Monitor"}
          </Text>
        </View>

        {/* Settings tab — on LEFT side (same side as drawer) */}
        <Animated.View
          style={[
            styles.settingsTab,
            {
              opacity: pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.5, 1],
              }),
            },
          ]}
        >
          <TouchableOpacity
            onPress={() => drawerRef.current?.openDrawer()}
            style={styles.settingsTabInner}
          >
            <Text style={styles.settingsTabArrow}>›</Text>
          </TouchableOpacity>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.scroll}>

          <View style={styles.statusCard}>
            <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
            <Text style={styles.statusText}>
              {status === "idle"    && "Not Running"}
              {status === "running" && "Scanning..."}
            </Text>
            <Text style={styles.statusSub}>
              {status === "idle"    && "Press START to begin monitoring"}
              {status === "running" && `Every ${scanInterval}s · Running in background`}
            </Text>
          </View>

          <View style={styles.buttonArea}>
            {wifiError && (
              <View style={{ backgroundColor: "#7F1D1D", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: "#FCA5A5", fontSize: 13, textAlign: "center" }}>{wifiError}</Text>
              </View>
            )}
            {status === "idle" && (
              <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#16A34A" }]} onPress={handleStart}>
                <Text style={styles.mainButtonText}>START</Text>
              </TouchableOpacity>
            )}
            {status === "running" && (
              <TouchableOpacity style={[styles.mainButton, { backgroundColor: "#DC2626" }]} onPress={handleStop}>
                <Text style={styles.mainButtonText}>STOP</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.uploadArea}>
            <TouchableOpacity
              style={[styles.uploadButton, (uploading || status === "idle") && { opacity: 0.4 }]}
              onPress={handleManualUpload}
              disabled={uploading || status === "idle"}
            >
              <Text style={styles.uploadButtonText}>
                {uploading ? "Uploading..." : "⬆  Upload Now"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>HOME INVITE CODE</Text>
            <Text style={styles.bigCode}>{inviteCode || "—"}</Text>
            <Text style={styles.codeHint}>
              This code never changes. Share it to add devices to this home.
            </Text>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShareCode}>
              <Text style={styles.shareBtnText}>Share with other devices →</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>DEVICE INFO</Text>
            <Row label="Device Name" value={deviceName || "—"} />
            <Row label="Home ID"     value={`${homeId?.slice(0, 14)}...`} />
            <Row label="Status"      value={status.toUpperCase()} valueColor={dotColor} />
          </View>

        </ScrollView>
      </SafeAreaView>
    </DrawerLayoutAndroid>
  );
}

function Row({ label, value, valueColor }) {
  return (
    <View style={styles.row2}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#0F172A" },
  scroll:         { paddingBottom: 40 },

  // Header — force LTR always
  header:         {
    backgroundColor: "#2563EB",
    paddingVertical: 16,
    paddingHorizontal: 16,
    direction: "ltr",
    writingDirection: "ltr",
    alignItems: "flex-start",
  },
  headerTitle:    { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "left", writingDirection: "ltr" },
  headerSub:      { color: "#BFDBFE", fontSize: 12, marginTop: 2, textAlign: "left", writingDirection: "ltr" },

  // Settings tab — LEFT side, small
  settingsTab:    {
    position: "absolute",
    left: 0,
    top: "45%",
    zIndex: 100,
    elevation: 8,
  },
  settingsTabInner: {
    backgroundColor: "#2563EB",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    width: 22,
  },
  settingsTabArrow: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Status
  statusCard:     { margin: 20, backgroundColor: "#1E293B", borderRadius: 16, padding: 24, alignItems: "center" },
  statusDot:      { width: 16, height: 16, borderRadius: 8, marginBottom: 12 },
  statusText:     { color: "#F1F5F9", fontSize: 20, fontWeight: "700" },
  statusSub:      { color: "#94A3B8", fontSize: 13, marginTop: 6, textAlign: "center" },

  // Buttons
  buttonArea:     { paddingHorizontal: 20, marginTop: 8 },
  mainButton:     { borderRadius: 14, paddingVertical: 18, alignItems: "center" },
  mainButtonText: { color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: 1 },
  row:            { flexDirection: "row", gap: 12 },
  secondaryButton: { flex: 1, borderRadius: 14, paddingVertical: 18, alignItems: "center" },

  // Upload
  uploadArea:       { paddingHorizontal: 20, marginTop: 12 },
  uploadButton:     { backgroundColor: "#1E293B", borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  uploadButtonText: { color: "#F1F5F9", fontSize: 15, fontWeight: "600" },

  // Cards
  card:           { margin: 20, marginTop: 16, backgroundColor: "#1E293B", borderRadius: 16, padding: 16 },
  cardTitle:      { color: "#94A3B8", fontSize: 12, fontWeight: "600", marginBottom: 12, letterSpacing: 1 },
  bigCode:        { color: "#F1F5F9", fontSize: 38, fontWeight: "700", textAlign: "center", letterSpacing: 10, marginVertical: 8 },
  codeHint:       { color: "#475569", fontSize: 12, textAlign: "center", marginTop: 4 },
  shareBtn:       { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  shareBtnText:   { color: "#2563EB", fontSize: 13, fontWeight: "600" },
  row2:           { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#0F172A" },
  rowLabel:       { color: "#64748B", fontSize: 13 },
  rowValue:       { color: "#F1F5F9", fontSize: 13, fontWeight: "500" },

  // Drawer
  drawerHeader:       { backgroundColor: "#2563EB", padding: 24, paddingTop: 48 },
  drawerTitle:        { color: "#fff", fontSize: 18, fontWeight: "700" },
  drawerSub:          { color: "#BFDBFE", fontSize: 13, marginTop: 2 },
  drawerSection:      { padding: 16, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  drawerSectionTitle: { color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 12 },
  drawerRow:          { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  drawerLabel:        { color: "#94A3B8", fontSize: 14, marginBottom: 4 },
  drawerValue:        { color: "#F1F5F9", fontSize: 13 },
  drawerInput:        { backgroundColor: "#1E293B", borderRadius: 8, padding: 10, color: "#F1F5F9", fontSize: 14, marginBottom: 8 },
  drawerButton:       { backgroundColor: "#1E293B", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
  drawerButtonText:   { color: "#fff", fontSize: 14, fontWeight: "600" },
  chipRow:            { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip:               { borderWidth: 1, borderColor: "#334155", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive:         { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText:           { color: "#64748B", fontSize: 13 },
  chipTextActive:     { color: "#fff" },
  inviteCodeBox:      { backgroundColor: "#0F172A", borderRadius: 12, padding: 16, marginTop: 8 },
  inviteCodeLabel:    { color: "#475569", fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 8, textAlign: "center" },
  inviteCode:         { color: "#F1F5F9", fontSize: 26, fontWeight: "700", textAlign: "center", letterSpacing: 8, marginBottom: 12 },
  inviteHint:         { color: "#475569", fontSize: 11, textAlign: "center", marginTop: 8 },
  smallBtn:           { borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  smallBtnText:       { color: "#fff", fontSize: 13, fontWeight: "600" },
});