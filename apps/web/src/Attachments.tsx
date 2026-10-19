import { useState } from "react";
import { ActionIcon, Alert, Button, Group, Loader, Modal, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { isPreviewImage, MAX_UPLOAD_BYTES, type UploadMeta } from "@rex/shared";
import type { DraftAttachment } from "./useAttachments";
import { uploadUrl } from "./api";
import { IconPaperclip, IconRefresh, IconX } from "./icons";

interface AttachmentItem {
  id: string; filename: string; mimeType: string; url?: string;
  status?: DraftAttachment["status"]; error?: string; canRetry?: boolean;
}

function AttachmentCard({ item, onOpen, onRemove, onRetry }: { item: AttachmentItem; onOpen: () => void; onRemove?: () => void; onRetry?: () => void }) {
  const [failed, setFailed] = useState(false);
  return <div className={`attachment-card${item.error ? " attachment-error" : ""}`}>
    {isPreviewImage(item.mimeType) && item.url ? <UnstyledButton className="attachment-image-button" aria-label={`Enlarge ${item.filename}`} onClick={onOpen}>
      {!failed ? <img src={item.url} alt={item.filename} onError={() => setFailed(true)} /> : <Text size="xs" p="sm">Preview unavailable</Text>}
    </UnstyledButton> : item.url && !onRemove ? <a className="attachment-file" href={item.url} aria-label={`Download ${item.filename}`}><IconPaperclip /></a> : <div className="attachment-file"><IconPaperclip /></div>}
    {onRemove ? <Tooltip label="Remove attachment"><ActionIcon className="attachment-remove" variant="filled" color="dark" size={44} aria-label={`Remove ${item.filename}`} onClick={onRemove}><IconX size={20} /></ActionIcon></Tooltip> : null}
    <div className="attachment-caption"><Text size="xs" truncate title={item.filename}>{item.filename}</Text>{item.status === "uploading" ? <Group gap={6} role="status"><Loader size={12} /><Text size="xs">Uploading…</Text></Group> : null}</div>
    {item.error ? <div className="attachment-failure" role="alert"><Text size="xs">{item.error}</Text>{onRetry ? <Button size="xs" variant="subtle" leftSection={<IconRefresh size={16} />} onClick={onRetry}>Retry</Button> : null}</div> : null}
  </div>;
}

function AttachmentGallery({ items, onRemove, onRetry, draft = false }: { items: AttachmentItem[]; onRemove?: (id: string) => void; onRetry?: (id: string) => void; draft?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const images = items.filter((item) => isPreviewImage(item.mimeType) && item.url);
  const index = images.findIndex((item) => item.id === selectedId);
  const selected = images[index];
  function open(id: string) { setImageError(false); setSelectedId(id); }
  function move(step: number) { if (images.length) open(images[(index + step + images.length) % images.length]!.id); }
  return <>
    <div className={`attachment-gallery${draft ? " attachment-gallery-draft" : ""}`} role="group" aria-label={draft ? "Attachments ready to send" : "Message attachments"}>
      {items.map((item) => <AttachmentCard key={item.id} item={item} onOpen={() => open(item.id)} onRemove={onRemove ? () => onRemove(item.id) : undefined} onRetry={onRetry && item.canRetry !== false ? () => onRetry(item.id) : undefined} />)}
    </div>
    <Modal opened={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.filename ?? "Image preview"} closeButtonProps={{ "aria-label": "Close image preview" }} size="calc(100vw - 32px)" centered className="image-viewer" onKeyDown={(event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    }}>
      {selected ? <>
        {imageError ? <Alert color="orange" title="Image unavailable">This image could not be loaded. Close the preview and try again.</Alert> : <img key={selected.id} className="image-viewer-image" src={selected.url} alt={selected.filename} onError={() => setImageError(true)} />}
        {images.length > 1 ? <Group justify="space-between" mt="md"><Button variant="default" onClick={() => move(-1)}>Previous image</Button><Text size="sm" aria-live="polite">{index + 1} / {images.length}</Text><Button variant="default" onClick={() => move(1)}>Next image</Button></Group> : null}
      </> : null}
    </Modal>
  </>;
}

export function DraftAttachments({ items, onRemove, onRetry }: { items: DraftAttachment[]; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  return <AttachmentGallery draft items={items.map((item) => ({ id: item.id, filename: item.file.name, mimeType: item.upload?.mimeType ?? item.file.type, url: item.preview ?? (item.upload ? uploadUrl(item.upload.id) : undefined), status: item.status, error: item.error, canRetry: item.file.size <= MAX_UPLOAD_BYTES }))} onRemove={onRemove} onRetry={onRetry} />;
}

export function SentAttachments({ items }: { items: UploadMeta[] }) {
  return <AttachmentGallery items={items.map((item) => ({ ...item, url: uploadUrl(item.id) }))} />;
}
