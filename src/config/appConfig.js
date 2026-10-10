export default {
  // ─── Branding ───────────────────────────────
  appName: "WiFi Monitor Plus",
  primaryColor: "#2563EB",
  secondaryColor: "#1E40AF",
  accentColor: "#3B82F6",
  logoUrl: null,

  // ─── Language & Layout ──────────────────────
  language: "en",
  rtl: false,

  // ─── Scan Settings Defaults ─────────────────
  scanIntervalSeconds: 300,
  uploadIntervalSeconds: 60,
  uploadOnCellular: false,

  // ─── Ping Targets ───────────────────────────
  pingTargets: [
    { label: "DNS Primary",   host: "8.8.8.8", enabled: true  },
    { label: "DNS Secondary", host: "8.8.4.4", enabled: false },
  ],

};