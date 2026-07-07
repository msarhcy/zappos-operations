const INSTALLATION_ID_KEY = "zappos.installation_id.v1";
const SEQUENCE_PREFIX = "zappos.telemetry_sequence.v1.";

export function getInstallationId(): string {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000";

  const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID();
  window.localStorage.setItem(INSTALLATION_ID_KEY, next);
  return next;
}

export function getDevicePlatform() {
  if (typeof navigator === "undefined") return "server";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return `${standalone ? "pwa" : "browser"}:${nav.userAgentData?.platform || navigator.platform || "unknown"}`;
}

export function nextTelemetrySequence(trackingSessionId: string): number {
  if (typeof window === "undefined") return 1;
  const key = `${SEQUENCE_PREFIX}${trackingSessionId}`;
  const current = Number(window.localStorage.getItem(key) || "0");
  const next = Number.isFinite(current) ? current + 1 : 1;
  window.localStorage.setItem(key, String(next));
  return next;
}
