import { useEffect, useRef, useState } from "react";
import { isPreviewImage, MAX_MESSAGE_ATTACHMENTS, MAX_UPLOAD_BYTES, type UploadMeta } from "@rex/shared";
import * as api from "./api";

export interface DraftAttachment {
  id: string;
  file: File;
  preview?: string;
  status: "uploading" | "ready" | "error";
  upload?: UploadMeta;
  error?: string;
}

export function useAttachments(onError: (message: string) => void) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const current = useRef<DraftAttachment[]>([]);
  function replace(next: DraftAttachment[]) { current.current = next; setItems(next); }
  function release(item: DraftAttachment, discard: boolean) {
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (discard && item.upload) void api.deleteUpload(item.upload.id).catch(() => {});
  }
  useEffect(() => () => {
    for (const item of current.current) release(item, true);
    current.current = [];
  }, []);

  async function upload(item: DraftAttachment) {
    try {
      const saved = await api.uploadFile(item.file);
      if (!current.current.some((entry) => entry.id === item.id)) { await api.deleteUpload(saved.id); return; }
      replace(current.current.map((entry) => entry.id === item.id ? { ...entry, upload: saved, status: "ready", error: undefined } : entry));
    } catch (err) {
      replace(current.current.map((entry) => entry.id === item.id ? { ...entry, status: "error", error: err instanceof Error ? err.message : String(err) } : entry));
    }
  }

  function add(files: File[]) {
    const slots = Math.max(0, MAX_MESSAGE_ATTACHMENTS - current.current.length);
    if (files.length > slots) onError(`You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files per message.`);
    const next = files.slice(0, slots).map((file): DraftAttachment => ({
      id: crypto.randomUUID(), file,
      preview: file.size <= MAX_UPLOAD_BYTES && isPreviewImage(file.type) ? URL.createObjectURL(file) : undefined,
      status: file.size > MAX_UPLOAD_BYTES ? "error" : "uploading",
      error: file.size > MAX_UPLOAD_BYTES ? "File too large (max 8MB)." : undefined,
    }));
    replace([...current.current, ...next]);
    for (const item of next) if (item.status === "uploading") void upload(item);
  }

  function remove(id: string) {
    const item = current.current.find((entry) => entry.id === id);
    replace(current.current.filter((entry) => entry.id !== id));
    if (item) release(item, true);
  }
  function retry(id: string) {
    const item = current.current.find((entry) => entry.id === id);
    if (!item || item.file.size > MAX_UPLOAD_BYTES) return;
    replace(current.current.map((entry) => entry.id === id ? { ...entry, status: "uploading", error: undefined } : entry));
    void upload(item);
  }
  function clear(discard = true) {
    const previous = current.current;
    replace([]);
    for (const item of previous) release(item, discard);
  }
  function restore(previous: DraftAttachment[]) {
    replace(previous.map((item) => ({ ...item, preview: isPreviewImage(item.file.type) ? URL.createObjectURL(item.file) : undefined })));
  }
  return { items, add, remove, retry, clear, restore, ready: items.length > 0 && items.every((item) => item.status === "ready") };
}
