import { DEFAULT_APP_SETTINGS, type AppSettings } from "@rex/shared";
import { db, nowIso } from "./db.js";

/** Workspace-wide settings an admin controls. Stored as one JSON value per key. */
export function getAppSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{ key: string; value: string }>;
  const saved: Record<string, unknown> = {};
  for (const row of rows) {
    try { saved[row.key] = JSON.parse(row.value); } catch { /* Ignore a corrupt value; the default applies. */ }
  }
  return normalizeAppSettings(saved);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeAppSettings(raw: Record<string, unknown>): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  return {
    signupMode: raw.signupMode === "closed" || raw.signupMode === "open" ? raw.signupMode : d.signupMode,
    workspaceName: typeof raw.workspaceName === "string" && raw.workspaceName.trim() ? raw.workspaceName.trim().slice(0, 48) : d.workspaceName,
    vmMemoryMb: clampInt(raw.vmMemoryMb, 1024, 65536, d.vmMemoryMb),
    vmCores: clampInt(raw.vmCores, 1, 32, d.vmCores),
    vmDiskGb: clampInt(raw.vmDiskGb, 8, 1024, d.vmDiskGb),
    vmIdleMinutes: clampInt(raw.vmIdleMinutes, 0, 1440, d.vmIdleMinutes),
    vmMaxRunning: clampInt(raw.vmMaxRunning, 1, 256, d.vmMaxRunning),
    maxBotsPerUser: clampInt(raw.maxBotsPerUser, 1, 500, d.maxBotsPerUser),
    shareWorkspaceKeys: typeof raw.shareWorkspaceKeys === "boolean" ? raw.shareWorkspaceKeys : d.shareWorkspaceKeys,
  };
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalizeAppSettings({ ...getAppSettings(), ...patch });
  const upsert = db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
  const ts = nowIso();
  db.transaction(() => { for (const [key, value] of Object.entries(next)) upsert.run(key, JSON.stringify(value), ts); })();
  return next;
}
