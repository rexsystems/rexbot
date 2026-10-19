import { DEFAULT_SETTINGS, type ClientSettings } from "@rex/shared";

const KEY = "rex.settings.v2";

export function loadSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ClientSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
