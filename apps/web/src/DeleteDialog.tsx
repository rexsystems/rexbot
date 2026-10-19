import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { IconGroup } from "./icons";
import { deleteConversation } from "./api";

export function DeleteDialog({ conversation, onClose, onDeleted }: { conversation: Conversation; onClose: () => void; onDeleted: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = conversation.bot?.name ?? conversation.title;
  async function remove() {
    setPending(true); setError(null);
    try {
      await Promise.all([deleteConversation(conversation.id), new Promise((resolve) => setTimeout(resolve, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 850))]);
      onDeleted();
    } catch (err) { setPending(false); setError(err instanceof Error ? err.message : String(err)); }
  }
  return <Modal opened onClose={onClose} title={conversation.kind === "group" ? "Delete group?" : "Delete conversation?"} centered size="sm" closeOnEscape={!pending} closeOnClickOutside={!pending} withCloseButton={!pending} closeButtonProps={{ "aria-label": "Close deletion confirmation" }}>
    <Stack>
      <div className={`delete-scene${pending ? " deleting" : ""}`} aria-hidden="true"><div className="delete-weight" /><div className="delete-target">{conversation.kind === "group" ? <IconGroup size={86} /> : <BlobAvatar seed={conversation.id} appearance={conversation.bot} size={100} />}</div></div>
      <Text fw={600} ta="center">{name}</Text>
      <Text size="sm" c="dimmed">Are you sure? This permanently deletes this conversation and its messages.{conversation.kind === "group" ? " The bots in this group will stay saved." : ""}</Text>
      {error ? <Alert role="alert" color="red" title="Could not delete">{error}</Alert> : null}
      <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={pending}>Keep it</Button><Button color="red.8" loading={pending} onClick={() => void remove()}>Delete permanently</Button></Group>
    </Stack>
  </Modal>;
}
