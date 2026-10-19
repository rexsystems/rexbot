import { useState } from "react";
import { ActionIcon, Group, Popover, Tooltip, UnstyledButton } from "@mantine/core";
import { REACTION_EMOJIS, type ChatMessage, type MessageReaction, type ReactionEmoji } from "@rex/shared";
import { IconReact } from "./icons";
import { reactToMessage } from "./api";

export function MessageReactions({ message, enabled, onChange, onError }: { message: ChatMessage; enabled: boolean; onChange: (reactions: MessageReaction[]) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function react(emoji: ReactionEmoji) {
    setPending(true);
    try { onChange((await reactToMessage(message.id, emoji)).reactions); setOpen(false); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }
  return (
    <Group className="message-reactions" gap={4} mt={4}>
      {message.reactions?.map((reaction) => reaction.actor === "rex" ? <span className="reaction-chip" key="rex"><span role="img" aria-label={`Bot reacted ${reaction.emoji}`}>{reaction.emoji}</span></span> : <UnstyledButton className="reaction-chip selected" key="user" aria-label={`Remove your ${reaction.emoji} reaction`} disabled={pending || !enabled} onClick={() => void react(reaction.emoji)}>{reaction.emoji}</UnstyledButton>)}
      {enabled ? <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow>
        <Popover.Target><Tooltip label="React to message"><ActionIcon className="reaction-trigger" variant="subtle" color="gray" size={28} aria-label="React to message" aria-expanded={open} onClick={() => setOpen(!open)}><IconReact size={17} /></ActionIcon></Tooltip></Popover.Target>
        <Popover.Dropdown p={4}><Group gap={2}>{REACTION_EMOJIS.map((emoji) => <ActionIcon key={emoji} size={44} variant="subtle" aria-label={`React ${emoji}`} disabled={pending} onClick={() => void react(emoji)}><span className="reaction-emoji">{emoji}</span></ActionIcon>)}</Group></Popover.Dropdown>
      </Popover> : null}
    </Group>
  );
}
