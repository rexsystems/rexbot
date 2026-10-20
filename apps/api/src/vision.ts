import fs from "node:fs";
import type { LlmMessage } from "./llm.js";
import type { ModelSettings } from "./providers.js";
import { db } from "./db.js";
import { detectImage } from "./uploads.js";

export interface ModelImage { mimeType: "image/png" | "image/jpeg" | "image/webp"; data: string }
export function recentImageMessages(messages: LlmMessage[]): LlmMessage[] {
  let remaining = 4;
  return messages.slice().reverse().map((message) => {
    const images = message.images?.slice(-remaining);
    const kept = remaining > 0 ? images : undefined;
    remaining -= kept?.length ?? 0;
    return { ...message, images: kept?.length ? kept : undefined };
  }).reverse();
}
export function modelImage(bytes: Buffer): ModelImage | null {
  const mime = detectImage(bytes);
  if (bytes.length > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(mime ?? "")) return null;
  return { mimeType: mime as ModelImage["mimeType"], data: bytes.toString("base64") };
}

export function uploadImages(ids: string[], settings: ModelSettings): ModelImage[] {
  if (!settings.route?.vision || !settings.route.userId) return [];
  return ids.slice(0, 4).flatMap((id) => {
    const row = db.prepare("SELECT path FROM uploads WHERE id = ? AND user_id = ?").get(id, settings.route!.userId) as { path: string } | undefined;
    if (!row) return [];
    try {
      if (fs.statSync(row.path).size > 5 * 1024 * 1024) return [];
      const image = modelImage(fs.readFileSync(row.path));
      return image ? [image] : [];
    } catch { return []; }
  });
}

export function openAiMessages(messages: LlmMessage[]) {
  return messages.map(({ images, ...message }) => images?.length && message.role === "user" ? {
    ...message,
    content: [...images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } })), { type: "text", text: message.content || "Inspect this image." }],
  } : message);
}
