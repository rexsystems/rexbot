import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, nowIso, uploadsDir } from "../db.js";
import { isPreviewImage, MAX_UPLOAD_BYTES } from "@rex/shared";
import { detectImage } from "../uploads.js";
import { bodyLimit } from "hono/body-limit";

export const uploadRoutes = new Hono();

uploadRoutes.use("/uploads", bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 128 * 1024, onError: (c) => c.json({ error: "File too large (max 8MB)" }, 413) }));

uploadRoutes.post("/uploads", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json({ error: "file is required" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "File too large (max 8MB)" }, 400);

  const ab = await file.arrayBuffer();
  if (ab.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: "File too large (max 8MB)" }, 400);
  }

  const id = nanoid();
  const filename = (file.name || "upload.bin").slice(0, 180);
  const detected = detectImage(Buffer.from(ab));
  if (isPreviewImage(file.type) && !detected) return c.json({ error: "Image format not recognized. Use PNG, JPEG, WebP, GIF or AVIF." }, 400);
  const mimeType = detected || (file.type.startsWith("image/") ? "application/octet-stream" : file.type || "application/octet-stream");
  const dest = path.join(uploadsDir(), `${id}-${filename.replace(/[^\w.\-]+/g, "_")}`);
  fs.writeFileSync(dest, Buffer.from(ab));

  let textContent: string | null = null;
  const lower = filename.toLowerCase();
  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".txt")
  ) {
    textContent = Buffer.from(ab).toString("utf8").slice(0, 120_000);
  }

  const ts = nowIso();
  db.prepare(
    `INSERT INTO uploads (id, conversation_id, filename, mime_type, size, path, text_content, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(id, filename, mimeType, ab.byteLength, dest, textContent, ts);

  return c.json({
    id,
    filename,
    mimeType,
    size: ab.byteLength,
    createdAt: ts,
  });
});

uploadRoutes.get("/uploads/:id/content", (c) => {
  const upload = db.prepare("SELECT filename, mime_type, path FROM uploads WHERE id = ?").get(c.req.param("id")) as { filename: string; mime_type: string; path: string } | undefined;
  if (!upload || !fs.existsSync(upload.path)) return c.json({ error: "Attachment not found" }, 404);
  const preview = isPreviewImage(upload.mime_type);
  return new Response(fs.readFileSync(upload.path), { headers: {
    "Content-Type": preview ? upload.mime_type : "application/octet-stream",
    "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(upload.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  } });
});

uploadRoutes.delete("/uploads/:id", (c) => {
  const id = c.req.param("id");
  const upload = db.prepare("SELECT path, message_id FROM uploads WHERE id = ?").get(id) as { path: string; message_id: string | null } | undefined;
  if (!upload) return c.json({ ok: true });
  if (upload.message_id) return c.json({ error: "Sent attachments cannot be removed from a draft" }, 409);
  fs.rmSync(upload.path, { force: true });
  db.prepare("DELETE FROM uploads WHERE id = ? AND message_id IS NULL").run(id);
  return c.json({ ok: true });
});
