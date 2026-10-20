import { useRef, useState } from "react";
import { ActionIcon, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import type { Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { IconComputer, IconCustomize, IconGroup, IconTrash } from "./icons";

export function SidebarConversation({ conversation, active, busy, onOpen, onEdit, onDelete, onComputer }: {
  conversation: Conversation;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onComputer?: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const group = conversation.kind === "group";
  const name = conversation.bot?.name ?? conversation.title;
  const openMenu = () => { menuButton.current?.focus(); setOpened(true); };

  return (
    <div className="sidebar-conversation" data-menu-open={opened || undefined} onContextMenu={(event) => { event.preventDefault(); openMenu(); }} onKeyDown={(event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMenu(); }
    }}>
      <UnstyledButton className={`chat-nav${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={onOpen}>
        <Group gap="sm" wrap="nowrap">
          {group ? <IconGroup size={32} /> : <BlobAvatar seed={conversation.id} appearance={conversation.bot} size={40} pulse={active && busy} float={active} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="chat-nav-title">{name}</div>
            <Text size="xs" c="dimmed" truncate>{group ? `${conversation.memberIds?.length ?? 0} members` : conversation.bot ? "Your teammate" : "Conversation"}</Text>
          </div>
        </Group>
      </UnstyledButton>
      <Menu opened={opened} onChange={setOpened} position="bottom-end" width={210} withinPortal withInitialFocusPlaceholder={false}>
        <Menu.Target>
          <ActionIcon ref={menuButton} className="sidebar-conversation-menu" aria-label={`Actions for ${name}`} variant="transparent" color="gray" size={44}><span aria-hidden="true">⋯</span></ActionIcon>
        </Menu.Target>
        <Menu.Dropdown aria-label={`Actions for ${name}`}>
          <Menu.Label>{name}</Menu.Label>
          <Menu.Item data-autofocus onClick={onOpen}>Open chat</Menu.Item>
          <Menu.Item leftSection={<IconCustomize size={18} />} onClick={onEdit}>{group ? "Group settings" : "Customize bot"}</Menu.Item>
          {!group && conversation.bot && onComputer ? <Menu.Item leftSection={<IconComputer size={18} />} onClick={onComputer}>Open computer</Menu.Item> : null}
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={18} />} onClick={onDelete}>{group ? "Delete group" : "Delete conversation"}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
