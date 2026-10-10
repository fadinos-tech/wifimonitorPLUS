import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator, I18nManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import appConfig from "../config/appConfig";
import { getCurrentWifi, requestWifiPermissions } from "../services/wifiScanner";
import { saveSession, getDeviceInfo } from "../services/sessionService";

// ─── Force LTR regardless of device language ─────────────
I18nManager.forceRTL(false);

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep]             = useState("checking");
  const [wifiInfo, setWifiInfo]     = useState(null);
  const [wifiError, setWifiError]   = useState(null);
  const [inviteCode, setInviteCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [loading, setLoading]       = useState(false);

  const version = require("../../app.json").expo.version;

  useEffect(() => {
    async function check() {
      await requestWifiPermissions();
      const wifi = await getCurrentWifi();
      setWifiInfo(wifi);
      setStep("name");
    }
    check();
  }, []);

  async function handleNameNext() {
    if (!deviceName.trim()) {
      Alert.alert("Device Name", "Please enter a name for this device.");
      return;
    }
    setStep("confirm");
  }

  // ─── YES — move on to the code step (does not create a Home) ───
  function handleConfirmHome() {
    // Require an active WiFi connection before continuing
    if (!wifiInfo?.ssid || wifiInfo.ssid === "Unknown Network") {
      setWifiError("Not connected to a WiFi network. Please connect and try again.");
      return;
    }
    setWifiError(null);
    setStep("code");
  }

  // ─── Join a Home with an invite code ─────────────────────
  async function handleInviteCode() {
    if (inviteCode.trim().length !== 6) {
      Alert.alert("Invalid Code", "Invite code must be exactly 6 characters.");
      return;
    }

    // Require an active WiFi connection before joining a home
    if (!wifiInfo?.ssid || wifiInfo.ssid === "Unknown Network") {
      Alert.alert("No WiFi", "Please connect to your home WiFi network first.");
      return;
    }

    setLoading(true);
    const deviceId   = `device_${Date.now()}`;
    const deviceInfo = await getDeviceInfo();
    deviceInfo.name  = deviceName;

    const { getOrCreateHome } = require("../services/firebaseService");

    let homeId = null;
    try {
      homeId = await getOrCreateHome({
        inviteCode: inviteCode.trim().toUpperCase(),
        bssid:      wifiInfo?.bssid,
        deviceId,
        deviceInfo,
      });
    } catch (err) {
      setLoading(false);
      const denied = err?.code === "firestore/permission-denied";
      Alert.alert(
        denied ? "Permission Denied" : "Connection Error",
        denied
          ? "The server rejected the request.\n\nThis usually means the Firestore security rules need to be updated.\n\n" +
            `Details: ${err?.message || "permission denied"}`
          : `Could not reach the server.\n\nCheck your internet connection and try again.\n\nDetails: ${err?.message || "unknown error"}`
      );
      return;
    }

    if (homeId) {
      const session = {
        homeId,
        deviceId,
        deviceName,
        ssid: wifiInfo?.ssid || "",
      };
      await saveSession(session);
      onComplete(session);
    } else {
      Alert.alert(
        "Code Not Found",
        "The invite code was not found.\n\nPlease check the code and try again.\n\nNote: Codes are created from the web dashboard."
      );
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{appConfig.appName}</Text>
        <Text style={styles.headerSub}>v{version} · Setup</Text>
      </View>

      <View style={styles.content}>

        {/* Checking */}
        {step === "checking" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={appConfig.primaryColor} />
            <Text style={styles.loadingText}>Detecting your network...</Text>
          </View>
        )}

        {/* Step 1 — Device Name */}
        {step === "name" && (
          <View>
            <Text style={styles.title}>Name this device</Text>
            <Text style={styles.hint}>
              Give this device a name so you can identify it in the dashboard (e.g. "Living Room", "Bedroom").
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Living Room"
              placeholderTextColor="#475569"
              value={deviceName}
              onChangeText={setDeviceName}
              maxLength={30}
              textAlign="left"
            />
            <TouchableOpacity
              style={[styles.button, { backgroundColor: appConfig.primaryColor }]}
              onPress={handleNameNext}
            >
              <Text style={styles.buttonText}>Next →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2 — Confirm Network */}
        {step === "confirm" && (
          <View>
            <Text style={styles.title}>Is this your home network?</Text>

            {/* WiFi error */}
            {(!wifiInfo?.ssid || wifiInfo.ssid === "Unknown Network") ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>⚠️ Not connected to WiFi</Text>
                <Text style={styles.errorText}>
                  Please connect to your home WiFi network first, then come back to continue.
                </Text>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: appConfig.primaryColor, marginTop: 16 }]}
                  onPress={async () => {
                    const wifi = await getCurrentWifi();
                    setWifiInfo(wifi);
                  }}
                >
                  <Text style={styles.buttonText}>↻ Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.networkCard}>
                  <Text style={styles.networkName}>{wifiInfo?.ssid}</Text>
                  <Text style={styles.networkDetail}>BSSID: {wifiInfo?.bssid || "—"}</Text>
                  <Text style={styles.networkDetail}>IP: {wifiInfo?.ip || "—"}</Text>
                  <Text style={styles.networkDetail}>Band: {wifiInfo?.band || "—"}</Text>
                </View>
                <Text style={styles.hint}>
                  Only confirm if you are connected to the WiFi network you want to monitor.
                </Text>
                {wifiError && (
                  <View style={styles.errorCard}>
                    <Text style={styles.errorText}>{wifiError}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#16A34A" }]}
                  onPress={handleConfirmHome}
                >
                  <Text style={styles.buttonText}>✓ Yes — This is my home network</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#1E293B", marginTop: 12, borderWidth: 1, borderColor: "#334155" }]}
                  onPress={() => {
                    Alert.alert(
                      "Connect to WiFi",
                      "Please connect to your home WiFi network first, then press Try Again.",
                      [
                        { text: "Try Again", onPress: async () => {
                          const wifi = await getCurrentWifi();
                          setWifiInfo(wifi);
                        }},
                        { text: "Cancel", style: "cancel" },
                      ]
                    );
                  }}
                >
                  <Text style={[styles.buttonText, { color: "#94A3B8" }]}>✕ No — Connect to WiFi first</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Step 3 — Enter Invite Code */}
        {step === "code" && (
          <View>
            <Text style={styles.title}>Enter Invite Code</Text>
            <Text style={styles.hint}>
              Enter the invite code from your web dashboard.{"\n"}
              Codes are created at the dashboard — ask your administrator for the code.
            </Text>
            <TextInput
              style={[styles.input, { fontSize: 32, letterSpacing: 10, textAlign: "center", fontWeight: "700" }]}
              placeholder="123456"
              placeholderTextColor="#475569"
              value={inviteCode}
              onChangeText={(text) => setInviteCode(text.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              maxLength={6}
            />
            {loading ? (
              <ActivityIndicator size="large" color={appConfig.primaryColor} style={{ marginTop: 24 }} />
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: appConfig.primaryColor }]}
                  onPress={handleInviteCode}
                >
                  <Text style={styles.buttonText}>Join Home →</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#475569", marginTop: 12 }]}
                  onPress={() => setStep("confirm")}
                >
                  <Text style={styles.buttonText}>← Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: "#0F172A" },
  header:        { backgroundColor: "#2563EB", paddingVertical: 20, paddingHorizontal: 24, direction: "ltr" },
  headerTitle:   { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "left", writingDirection: "ltr" },
  headerSub:     { color: "#BFDBFE", fontSize: 13, marginTop: 2, textAlign: "left" },
  content:       { flex: 1, padding: 24, direction: "ltr" },
  center:        { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText:   { color: "#94A3B8", fontSize: 16, marginTop: 16 },
  title:         { color: "#F1F5F9", fontSize: 22, fontWeight: "700", marginBottom: 20, textAlign: "left" },
  networkCard:   { backgroundColor: "#1E293B", borderRadius: 16, padding: 20, marginBottom: 20 },
  networkName:   { color: "#F1F5F9", fontSize: 20, fontWeight: "700", marginBottom: 8, textAlign: "left" },
  networkDetail: { color: "#94A3B8", fontSize: 14, marginTop: 4, textAlign: "left" },
  hint:          { color: "#64748B", fontSize: 14, lineHeight: 20, marginBottom: 24, textAlign: "left" },
  button:        { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  buttonText:    { color: "#fff", fontSize: 16, fontWeight: "700" },
  input:         { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, color: "#F1F5F9", fontSize: 16, marginBottom: 24 },
  errorCard:     { backgroundColor: "#7F1D1D", borderRadius: 12, padding: 16, marginBottom: 20 },
  errorTitle:    { color: "#FCA5A5", fontSize: 16, fontWeight: "700", marginBottom: 8, textAlign: "left" },
  errorText:     { color: "#FCA5A5", fontSize: 14, lineHeight: 20, textAlign: "left" },
});