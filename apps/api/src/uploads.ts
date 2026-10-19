import type { UploadMeta } from "@rex/shared";
import { db } from "./db.js";

export function messageUploads(messageId: string): UploadMeta[] {
  return db.prepare("SELECT id, filename, mime_type AS mimeType, size, created_at AS createdAt FROM uploads WHERE message_id = ? ORDER BY message_position, rowid").all(messageId) as UploadMeta[];
}

export function detectImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))) return "image/avif";
  return null;
}
