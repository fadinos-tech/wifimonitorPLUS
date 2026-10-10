import React, { useState, useEffect } from "react";
import { View, Text, ActivityIndicator, Modal, TouchableOpacity, Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import HomeScreen from "./src/screens/HomeScreen";
import { getSession } from "./src/services/sessionService";
import { checkForUpdate } from "./src/services/versionService";
import { ensureSignedIn } from "./src/services/authService";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [update, setUpdate]   = useState(null);

  useEffect(() => {
    async function checkSession() {
      const saved = await getSession();
      if (saved?.homeId && saved?.deviceId) {
        setSession(saved);
      }
      setLoading(false);
    }
    checkSession();
  }, []);

  // Anonymous sign-in + update check. Neither blocks app start-up.
  useEffect(() => {
    ensureSignedIn()
      .catch(() => {})
      .then(() => checkForUpdate())
      .then((res) => { if (res && res.status !== "ok") setUpdate(res); })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {!session ? (
        <OnboardingScreen onComplete={(data) => setSession(data)} />
      ) : (
        <HomeScreen
          homeId={session.homeId}
          deviceId={session.deviceId}
          deviceName={session.deviceName}
          inviteCode={session.inviteCode}
          homeSsid={session.ssid}
          onLeave={() => setSession(null)}
        />
      )}
      <UpdateModal update={update} onDismiss={() => setUpdate(null)} />
    </SafeAreaProvider>
  );
}

function UpdateModal({ update, onDismiss }) {
  if (!update) return null;
  const required = update.status === "required";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={required ? () => {} : onDismiss}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View style={{ backgroundColor: "#1E293B", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380 }}>
          <Text style={{ color: "#F1F5F9", fontSize: 20, fontWeight: "700", marginBottom: 8 }}>
            {required ? "Update Required" : "Update Available"}
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
            {update.message
              ? update.message
              : required
                ? `Version ${update.current} is no longer supported. Please update to ${update.latest} to continue.`
                : `Version ${update.latest} is available (you have ${update.current}).`}
          </Text>

          <TouchableOpacity
            style={{ backgroundColor: "#2563EB", borderRadius: 10, paddingVertical: 13, alignItems: "center" }}
            onPress={() => Linking.openURL(update.url)}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Update Now</Text>
          </TouchableOpacity>

          {!required && (
            <TouchableOpacity style={{ paddingVertical: 12, alignItems: "center" }} onPress={onDismiss}>
              <Text style={{ color: "#64748B", fontSize: 14 }}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}
