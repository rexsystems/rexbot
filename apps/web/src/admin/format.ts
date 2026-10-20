export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 minutes ago" for recent times, a date for older ones, "Never" for null. */
export function formatWhen(iso: string | null) {
  if (!iso) return "Never";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "Unknown";
  const seconds = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "Just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const STATE_COLORS: Record<string, string> = { running: "green", starting: "yellow", stopping: "yellow", stopped: "gray", missing: "gray" };
