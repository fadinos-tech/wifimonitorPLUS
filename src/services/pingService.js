// ─── Ping Service ─────────────────────────────────────────
// מבצע 3 פינגים לכל יעד וחושב ממוצע

export async function pingHost(host, count = 3) {
  const results = [];

  for (let i = 0; i < count; i++) {
    const result = await singlePing(host);
    results.push(result);
    // המתן 200ms בין פינגים
    await sleep(200);
  }

  // סנן תוצאות שנכשלו
  const successful = results.filter((r) => r.success);
  const failed     = results.filter((r) => !r.success);

  if (successful.length === 0) {
    return {
      host,
      latency:    null,
      jitter:     null,
      packetLoss: 100,
      success:    false,
    };
  }

  const latencies = successful.map((r) => r.latency);
  const avgLatency = average(latencies);
  const jitter     = calculateJitter(latencies);
  const packetLoss = Math.round((failed.length / count) * 100);

  return {
    host,
    latency:    Math.round(avgLatency),
    jitter:     Math.round(jitter),
    packetLoss,
    success:    true,
  };
}

// ─── פינג בודד ────────────────────────────────────────────
async function singlePing(host) {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 3000);

    await fetch(`http://${host}`, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return { success: true, latency: Date.now() - start };
  } catch (err) {
    // אם השרת דחה את הבקשה אבל ענה — זה עדיין הצלחה
    const latency = Date.now() - start;
    if (latency < 3000) {
      return { success: true, latency };
    }
    return { success: false, latency: null };
  }
}

// ─── פינג לכל היעדים ──────────────────────────────────────
export async function pingAllTargets(targets) {
  const results = {};

  // Gateway תמיד ראשון
  if (targets.gateway) {
    results.gateway = await pingHost(targets.gateway);
  }

  // Internet ping (8.8.8.8) תמיד
  results.internet = await pingHost("8.8.8.8");

  // DNS ויעדים נוספים במקביל
  const dnsTargets = targets.dns || [];
  const dnsResults = await Promise.all(
    dnsTargets
      .filter((t) => t.enabled)
      .map(async (t) => ({
        label:  t.label,
        result: await pingHost(t.host),
      }))
  );

  dnsResults.forEach(({ label, result }) => {
    results[label] = result;
  });

  return results;
}

// ─── עזר ──────────────────────────────────────────────────
function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calculateJitter(latencies) {
  if (latencies.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < latencies.length; i++) {
    total += Math.abs(latencies[i] - latencies[i - 1]);
  }
  return total / (latencies.length - 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}