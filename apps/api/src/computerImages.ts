import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { MAX_UPLOAD_BYTES } from "@rex/shared";
import { db, nowIso, uploadsDir } from "./db.js";
import { getOwnedConversation, insertMessage } from "./conversations.js";
import { detectImage, messageUploads } from "./uploads.js";

export function shareComputerImage(ownerId: string, conversationId: string, botId: string, image: { filename: string; bytes: Buffer }, caption?: string) {
  const conversation = getOwnedConversation(conversationId, ownerId);
  const bot = getOwnedConversation(botId, ownerId);
  if (!conversation || !bot?.bot || (conversation.id !== botId && !conversation.memberIds?.includes(botId))) throw new Error("This bot cannot attach images to that conversation.");
  const mime = detectImage(image.bytes);
  if (!mime || !image.bytes.length || image.bytes.length > MAX_UPLOAD_BYTES) throw new Error("Use a PNG, JPEG, WebP, GIF or AVIF image up to 8 MB.");
  if (caption !== undefined && (typeof caption !== "string" || caption.length > 1000)) throw new Error("Image caption must contain at most 1000 characters.");
  const id = nanoid();
  const filename = path.basename(image.filename).slice(0, 180) || "screenshot.png";
  const dest = path.join(uploadsDir(), `${id}-${filename.replace(/[^\w.\-]+/g, "_")}`);
  fs.writeFileSync(dest, image.bytes, { flag: "wx" });
  try {
    return db.transaction(() => {
      const message = insertMessage({ conversationId, role: "assistant", content: caption?.trim() || "", botId, botName: bot.bot!.name });
      db.prepare(`INSERT INTO uploads (id, conversation_id, message_id, message_position, filename, mime_type, size, path, text_content, created_at, user_id)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?)`).run(id, conversationId, message.id, filename, mime, image.bytes.length, dest, nowIso(), ownerId);
      message.attachments = messageUploads(message.id);
      return message;
    })();
  } catch (error) {
    fs.rmSync(dest, { force: true });
    throw error;
  }
}
