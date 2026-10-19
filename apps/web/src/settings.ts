import { DEFAULT_SETTINGS, type ClientSettings } from "@rex/shared";

const KEY = "rex.settings.v2";

export function loadSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<ClientSettings>;
    if (!saved.embeddingProvider && saved.embeddingModel && !saved.embeddingModel.startsWith("gemini-")) saved.embeddingProvider = "openai";
    return { ...DEFAULT_SETTINGS, ...saved, embeddingModel: saved.embeddingModel || DEFAULT_SETTINGS.embeddingModel };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ClientSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
