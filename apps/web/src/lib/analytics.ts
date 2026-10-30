// Anonymous product counts for the shared tn07 analytics Worker (dataset
// tn07_product_events). No user id is sent: who signed in lives in Firebase Auth.
const ENDPOINT = "https://analytics.tn07.dev/v1/events";

const SURFACE = {
  sign_in_completed: "auth",
  play_started: "booth",
  piece_created: "booth",
  assistant_connected: "connect",
} as const;

export function track(event: keyof typeof SURFACE, properties: Record<string, string> = {}) {
  if (location.hostname !== "jam.tn07.dev") return;
  const body = JSON.stringify({
    event,
    event_version: 1,
    product: "jam",
    surface: SURFACE[event],
    environment: "production",
    authority: "client",
    platform: "web",
    properties,
  });
  try {
    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}
