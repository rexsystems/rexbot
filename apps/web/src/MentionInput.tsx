import { useEffect, useId, useRef, useState, type ClipboardEventHandler } from "react";
import { Group, Text, Textarea, UnstyledButton } from "@mantine/core";
import type { Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { IconGroup } from "./icons";

export function MentionInput({ value, onChange, onSend, onPaste, disabled, label, members }: { value: string; onChange: (value: string) => void; onSend: () => void; onPaste: ClipboardEventHandler<HTMLTextAreaElement>; disabled: boolean; label: string; members: Conversation[] }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const match = value.slice(0, cursor).match(/(?:^|\s)@([^@\n]{0,32})$/);
  const signature = `${value}\n${cursor}`;
  const query = match?.[1]?.toLowerCase();
  const options = [{ id: "everyone", name: "everyone", bot: undefined as Conversation["bot"] }, ...members.map((member) => ({ id: member.id, name: member.bot!.name, bot: member.bot }))].filter((option) => query !== undefined && option.name.toLowerCase().startsWith(query));
  const opened = focused && !disabled && members.length > 0 && Boolean(match) && options.length > 0 && dismissed !== signature;
  const active = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => { if (opened) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [opened, active, listId]);

  function accept(index: number) {
    const option = options[index];
    if (!option || !match) return;
    const start = cursor - (match[1]?.length ?? 0) - 1;
    const mention = `@${option.name} `;
    const next = value.slice(0, start) + mention + value.slice(cursor);
    const end = start + mention.length;
    onChange(next); setCursor(end); setSelected(0); setDismissed(`${next}\n${end}`);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(end, end); });
  }

  return <div className="mention-input">
    {opened ? <div className="mention-menu" role="listbox" id={listId} aria-label="Mention a bot">
      {options.map((option, index) => <UnstyledButton role="option" aria-selected={index === active} id={`${listId}-${index}`} key={option.id} className="mention-option" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => accept(index)}>
        <Group gap="sm" wrap="nowrap">{option.bot ? <BlobAvatar seed={option.id} appearance={option.bot} size={30} /> : <IconGroup size={28} />}<div><Text size="sm">@{option.name}</Text>{option.id === "everyone" ? <Text size="xs" c="dimmed">Everyone replies, one at a time</Text> : null}</div></Group>
      </UnstyledButton>)}
    </div> : null}
    <Textarea ref={input} value={value} aria-label={label} placeholder={`${label}…`} aria-autocomplete={members.length ? "list" : undefined} aria-controls={opened ? listId : undefined} aria-activedescendant={opened ? `${listId}-${active}` : undefined} minRows={1} maxRows={6} autosize variant="unstyled" disabled={disabled}
      onFocus={() => { setFocused(true); setCursor(input.current?.selectionStart ?? value.length); }} onBlur={() => setFocused(false)} onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
      onChange={(event) => { onChange(event.currentTarget.value); setCursor(event.currentTarget.selectionStart); setSelected(0); }} onPaste={onPaste}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (opened && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Escape") { event.stopPropagation(); setDismissed(signature); }
          else if (event.key === "ArrowDown") setSelected((active + 1) % options.length);
          else if (event.key === "ArrowUp") setSelected((active + options.length - 1) % options.length);
          else accept(active);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
      }} />
  </div>;
}
