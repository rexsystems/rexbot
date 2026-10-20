import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { botReplyText, DEFAULT_BOT, type ProviderState } from "@rex/shared";
import {
  ActionIcon,
  Alert,
  AppShell,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  Avatar,
  Menu,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBotAdd,
  IconPaperclip,
  IconSearch,
  IconSend2,
  IconSettings,
  IconTool,
  IconTrash,
  IconWorldWww,
  IconX,
  IconComputer,
  IconMenu,
  IconBrain,
  IconClock,
  IconCustomize,
  IconGroup,
  IconPlus,
  IconChevronDown,
  IconMic,
  IconLink,
  IconAccount,
  IconAdmin,
  IconLogout,
} from "./icons";
import type {
  ChatMessage,
  ClientSettings,
  Conversation,
  MemoryItem,
  ComputerResult,
} from "@rex/shared";
import * as api from "./api";
import { BlobAvatar, OrbitDots } from "./BlobAvatar";
import {
  AssistantReply,
  formatToolDetail,
  isEmptyNoiseContent,
} from "./MarkdownMessage";
import { loadSettings, saveSettings } from "./settings";
import { SettingsModal } from "./SettingsModal";
import { RoutinesDrawer } from "./RoutinesDrawer";
import { AccountModal } from "./AccountModal";
import { useSession } from "./session";
import { ComputerPanel } from "./ComputerPanel";
import { MessageReactions } from "./MessageReactions";
import { BotEditor } from "./BotEditor";
import { GroupEditor } from "./GroupEditor";
import { VoiceModal } from "./VoiceModal";
import { DeleteDialog } from "./DeleteDialog";
import { MentionInput } from "./MentionInput";
import { DraftAttachments, SentAttachments } from "./Attachments";
import { useAttachments } from "./useAttachments";
import { startActivityPulse, stopActivityPulse } from "./uiSounds";
import { absoluteUrl, conversationPath, parseAppPath, syncUrl } from "./routes";

const ICON_LG = 18;
const THREAD_WINDOW = 40;

type ThreadItem =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "tool";
      id: string;
      tool: string;
      status: "running" | "done" | "error";
      detail?: string;
    };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function toThread(messages: ChatMessage[]): ThreadItem[] {
  return messages.filter((message) => message.toolName !== "react_message").map((message): ThreadItem => {
    if (message.role !== "tool") return { kind: "message", message };
    const result = message.toolName === "computer_exec" ? computerResult(message.content) : null;
    const failed = /^(computer_exec failed:|computer_(input|screenshot) (failed|unavailable)|message_bot failed:|message_bot unavailable)/.test(message.content) || Boolean(result && result.exitCode !== 0);
    return { kind: "tool", id: message.id, tool: message.toolName ?? "tool", status: failed ? "error" : "done", detail: message.content };
  });
}

function toolIcon(tool: string) {
  if (tool === "read_upload") return <IconPaperclip size={ICON_LG} />;
  if (tool === "message_bot") return <IconGroup size={ICON_LG} />;
  if (tool === "computer_input" || tool === "computer_screenshot") return <IconComputer size={ICON_LG} />;
  if (tool.includes("search")) return <IconSearch size={ICON_LG} stroke={1.5} />;
  if (tool.includes("fetch") || tool.includes("http")) {
    return <IconWorldWww size={ICON_LG} stroke={1.5} />;
  }
  return <IconTool size={ICON_LG} stroke={1.5} />;
}

function computerResult(detail?: string): ComputerResult | null {
  try {
    const value = JSON.parse(detail ?? "");
    return typeof value.command === "string" && typeof value.output === "string" && typeof value.exitCode === "number" ? value : null;
  } catch { return null; }
}

const toolLabels: Record<string, string> = { computer_exec: "Rex Computer", computer_input: "Mouse & keyboard", computer_screenshot: "Look at screen", web_search: "Web search", http_fetch: "Read webpage", read_upload: "Read attachment", message_bot: "Private bot message" };

export function App() {
  const [settings, setSettings] = useState<ClientSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [providerState, setProviderState] = useState<ProviderState | null>(null);
  useEffect(() => { api.providers.state().then(setProviderState).catch(() => undefined); }, []);
  const session = useSession();
  const [showComputer, setShowComputer] = useState(false);
  const [computerHasDesktop, setComputerHasDesktop] = useState(false);
  const [computerFocus, setComputerFocus] = useState<string | undefined>();
  const [botEditor, setBotEditor] = useState<Conversation | "new" | null>(null);
  const [groupEditor, setGroupEditor] = useState<Conversation | "new" | null>(null);
  const [voiceBot, setVoiceBot] = useState<Conversation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const desktopComputer = useMediaQuery("(min-width: 75em)");
  const [showMemory, setShowMemory] = useState(false);
  const [showRoutines, setShowRoutines] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = useAttachments(setError);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const earlierScrollRestore = useRef<{ height: number; top: number } | null>(null);
  const loadingEarlier = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [threadWindow, setThreadWindow] = useState(THREAD_WINDOW);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const activeBot = activeConversation?.bot ?? DEFAULT_BOT;
  const hiddenThreadCount = Math.max(0, thread.length - threadWindow);
  const visibleThread = useMemo(
    () => (hiddenThreadCount > 0 ? thread.slice(hiddenThreadCount) : thread),
    [thread, hiddenThreadCount],
  );
  const lastVisible = visibleThread.at(-1);
  const computerBots = useMemo(() => {
    if (!activeConversation) return [];
    const members = activeConversation.kind === "group" ? (activeConversation.memberIds ?? []).flatMap((id) => conversations.filter((item) => item.id === id)) : [activeConversation];
    return members.flatMap((item) => item.bot ? [{ id: item.id, name: item.bot.name }] : []);
  }, [activeConversation, conversations]);

  // Screen always follows the bot you are looking at (group: last speaker, else first member).
  const screenBotId = useMemo(() => {
    if (!computerBots.length) return undefined;
    if (activeConversation?.kind === "group") {
      if (computerFocus && computerBots.some((bot) => bot.id === computerFocus)) return computerFocus;
      return computerBots[0]?.id;
    }
    return computerBots[0]?.id;
  }, [activeConversation, computerBots, computerFocus]);

  useEffect(() => {
    if (activeConversation?.bot) setComputerFocus(activeConversation.id);
  }, [activeConversation?.id, activeConversation?.bot]);

  useEffect(() => {
    api.computerStatus().then((status) => {
      if (!status.desktop) return;
      setComputerHasDesktop(true);
      if (window.matchMedia("(min-width: 75em)").matches) setShowComputer(true);
      if (status.available && !status.running) void api.startComputer().catch(() => undefined);
    }).catch(() => undefined);
  }, []);
  const lastVisibleMessageId = lastVisible?.kind === "message" ? lastVisible.message.id : undefined;

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape" && !botEditor && !showSettings && !showMemory && !showRoutines) {
        if (voiceBot) { setVoiceBot(null); return; }
        setShowComputer(false);
        setMobileNav(false);
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [botEditor, showSettings, showMemory, showRoutines, voiceBot]);

  useEffect(() => {
    const toolRunning = thread.some((item) => item.kind === "tool" && item.status === "running");
    if (toolRunning) startActivityPulse();
    else stopActivityPulse();
    return () => stopActivityPulse();
  }, [thread]);

  const refreshLists = useCallback(async () => {
    const [convs, mems] = await Promise.all([
      api.listConversations(),
      api.listMemories(),
    ]);
    setConversations(convs);
    setMemories(mems);
    setListsLoaded(true);
    return convs;
  }, []);

  useEffect(() => {
    void refreshLists().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [refreshLists]);

  const bots = useMemo(() => conversations.filter((conversation) => conversation.kind !== "group"), [conversations]);
  const hasBots = bots.length > 0;

  useEffect(() => {
    if (thread.length === 0 || earlierScrollRestore.current) return;
    const scroller = threadScrollRef.current;
    if (scroller) {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distance > 140 && !busy) return;
    }
    bottomRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" });
  }, [thread, busy]);

  useLayoutEffect(() => {
    const scroller = threadScrollRef.current;
    const pending = earlierScrollRestore.current;
    if (!scroller || !pending) return;
    scroller.scrollTop = pending.top + (scroller.scrollHeight - pending.height);
    earlierScrollRestore.current = null;
    loadingEarlier.current = false;
  }, [threadWindow, visibleThread.length]);

  const onThreadScroll = useCallback(() => {
    const scroller = threadScrollRef.current;
    if (!scroller || loadingEarlier.current || hiddenThreadCount <= 0) return;
    if (scroller.scrollTop > 72) return;
    loadingEarlier.current = true;
    earlierScrollRestore.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
    setThreadWindow((count) => Math.min(thread.length, count + THREAD_WINDOW));
  }, [hiddenThreadCount, thread.length]);

  const openConversation = useCallback(async (id: string, opts?: { history?: "push" | "replace" | "none" }) => {
    setError(null);
    attachments.clear();
    const data = await api.getConversation(id);
    setActiveId(id);
    setThreadWindow(THREAD_WINDOW);
    setThread(toThread(data.messages));
    setConversations((previous) => {
      const exists = previous.some((item) => item.id === data.conversation.id);
      if (exists) return previous.map((item) => item.id === data.conversation.id ? data.conversation : item);
      return [data.conversation, ...previous];
    });
    setMobileNav(false);
    const history = opts?.history ?? "push";
    if (history !== "none") syncUrl(conversationPath(data.conversation), history);
  }, [attachments]);

  const goHome = useCallback((history: "push" | "replace" = "push") => {
    setActiveId(undefined);
    setThread([]);
    setThreadWindow(THREAD_WINDOW);
    attachments.clear();
    setDraft("");
    setError(null);
    setMobileNav(false);
    syncUrl("/app", history);
  }, [attachments]);

  // Deep link from URL, or open the first bot when opening /app with bots.
  useEffect(() => {
    if (!listsLoaded || botEditor) return;
    const route = parseAppPath(window.location.pathname);
    if (route.kind === "bot" || route.kind === "group") {
      if (activeId === route.id) return;
      if (!conversations.some((conversation) => conversation.id === route.id)) {
        setError(route.kind === "group" ? "That group was not found." : "That bot was not found.");
        if (hasBots) {
          void openConversation(bots[0]!.id, { history: "replace" }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        } else {
          goHome("replace");
        }
        return;
      }
      void openConversation(route.id, { history: "replace" }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
      return;
    }
    if (route.kind !== "app" || activeId || !hasBots) return;
    void openConversation(bots[0]!.id, { history: "replace" }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [listsLoaded, botEditor, activeId, conversations, hasBots, bots, openConversation, goHome]);

  useEffect(() => {
    function onPopState() {
      const route = parseAppPath(window.location.pathname);
      if (route.kind === "app" || route.kind === "landing") {
        setActiveId(undefined);
        setThread([]);
        attachments.clear();
        setDraft("");
        return;
      }
      if (route.kind !== "bot" && route.kind !== "group") return;
      void openConversation(route.id, { history: "none" }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [attachments, openConversation]);

  const newChat = () => {
    goHome("push");
  };

  const onSaveSettings = (next: ClientSettings) => {
    setSettings(next);
    saveSettings(next);
    setShowSettings(false);
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.items.length) || busy || (attachments.items.length > 0 && !attachments.ready)) return;
    if (!providerState?.active && !settings.llmApiKey.trim()) {
      setShowSettings(true);
      setError("Connect a model provider in Settings → Models first.");
      return;
    }

    setBusy(true);
    setError(null);
    setDraft("");

    const userMsg: ChatMessage = {
      id: uid(),
      conversationId: activeId ?? "pending",
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      attachments: attachments.items.flatMap((item) => item.upload ? [item.upload] : []),
    };
    const assistantId = uid();
    let streamingAssistantId = assistantId;
    let conversationId = activeId;
    let speaker: { botId?: string; botName?: string } = {};
    let speakerStarted = false;
    setThread((prev) => [
      ...prev,
      { kind: "message", message: userMsg },
      {
        kind: "message",
        message: {
          id: assistantId,
          conversationId: activeId ?? "pending",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    const sentAttachments = attachments.items;
    const uploadIds = sentAttachments.flatMap((item) => item.upload ? [item.upload.id] : []);
    attachments.clear(false);
    let accepted = false;

    try {
      await api.streamChat({
        conversationId: activeId,
        message: text,
        uploadIds,
        settings,
        onEvent: (ev) => {
          if (ev.type === "speaker") {
            speaker = { botId: ev.botId, botName: ev.botName };
            const currentSpeaker = speaker;
            if (!speakerStarted) {
              const currentId = streamingAssistantId;
              setThread((prev) => prev.map((item) => item.kind === "message" && item.message.id === currentId ? { ...item, message: { ...item.message, ...currentSpeaker } } : item));
            } else {
              const nextId = uid();
              streamingAssistantId = nextId;
              setThread((prev) => [...prev, { kind: "message", message: { id: nextId, conversationId: conversationId ?? "pending", role: "assistant", content: "", createdAt: new Date().toISOString(), ...currentSpeaker } }]);
            }
            speakerStarted = true;
          }
          if (ev.type === "user_message") {
            accepted = true;
            setThread((prev) => prev.map((item) => item.kind === "message" && item.message.id === userMsg.id ? { kind: "message", message: ev.message } : item));
          }
          if (ev.type === "reaction") {
            setThread((prev) => prev.map((item) => item.kind === "message" && item.message.id === ev.messageId ? { ...item, message: { ...item.message, reactions: ev.reactions } } : item));
          }
          if (ev.type === "message_done") {
            const currentId = streamingAssistantId;
            setThread((prev) => prev.map((item) => item.kind === "message" && item.message.id === currentId ? { ...item, message: { ...item.message, id: ev.messageId } } : item));
          }
          if (ev.type === "conversation") {
            conversationId = ev.conversation.id;
            setActiveId(ev.conversation.id);
            syncUrl(conversationPath(ev.conversation), activeId ? "replace" : "push");
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === ev.conversation.id);
              if (exists) {
                return prev.map((c) =>
                  c.id === ev.conversation.id ? ev.conversation : c,
                );
              }
              return [ev.conversation, ...prev];
            });
          }
          if (ev.type === "delta") {
            const currentId = streamingAssistantId;
            setThread((prev) =>
              prev.map((item) => {
                if (item.kind !== "message" || item.message.id !== currentId) {
                  return item;
                }
                return {
                  ...item,
                  message: {
                    ...item.message,
                    content: item.message.content + ev.text,
                  },
                };
              }),
            );
          }
          if (ev.type === "tool_start") {
            if (ev.tool === "computer_input" || ev.tool === "computer_screenshot") {
              setComputerFocus(speaker.botId);
              if (desktopComputer) setShowComputer(true);
            }
            const id = uid();
            const previousId = streamingAssistantId;
            const nextId = uid();
            const toolSpeaker = { ...speaker };
            streamingAssistantId = nextId;
            setThread((prev) => [
              ...prev.filter(
                (t) =>
                  !(
                    t.kind === "message" &&
                    t.message.id === previousId &&
                    (!t.message.content || isEmptyNoiseContent(t.message.content))
                  ),
              ),
              ...(ev.tool === "react_message" ? [] : [{
                kind: "tool" as const,
                id,
                tool: ev.tool,
                status: "running" as const,
                detail: formatToolDetail(ev.input),
              }]),
              {
                kind: "message",
                message: {
                  id: nextId,
                  ...toolSpeaker,
                  conversationId: activeId ?? "pending",
                  role: "assistant",
                  content: "",
                  createdAt: new Date().toISOString(),
                },
              },
            ]);
          }
          if (ev.type === "tool_end") {
            setThread((prev) =>
              prev.map((item) => {
                if (
                  item.kind !== "tool" ||
                  item.tool !== ev.tool ||
                  item.status !== "running"
                ) {
                  return item;
                }
                const detail =
                  ev.output ??
                  formatToolDetail(ev.error) ??
                  item.detail;
                return {
                  ...item,
                  status: ev.error ? "error" : "done",
                  detail,
                };
              }),
            );
          }
          if (ev.type === "error") {
            setError(ev.message);
          }
        },
      });
      if (conversationId) setThread(toThread((await api.getConversation(conversationId)).messages));
      await refreshLists();
    } catch (e) {
      if (!accepted) {
        attachments.restore(sentAttachments);
        setDraft(text);
        setThread((previous) => previous.filter((item) => item.kind !== "message" || (item.message.id !== userMsg.id && item.message.id !== assistantId)));
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activeTitle = useMemo(() => {
    const conversation = conversations.find((c) => c.id === activeId);
    return conversation?.bot?.name ?? conversation?.title ?? "Rex";
  }, [conversations, activeId]);

  useEffect(() => {
    document.title = activeId ? `${activeTitle} · Rex` : "Rex";
  }, [activeId, activeTitle]);

  return (
    <>
      <AppShell
        onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; if (!busy) setDraggingFiles(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; } }}
        onDragLeave={(event) => { if (event.dataTransfer.types.includes("Files")) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false); } }}
        onDrop={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (!busy) { setError(null); attachments.add(Array.from(event.dataTransfer.files)); } } }}
        className="app-shell"
        navbar={{ width: 290, breakpoint: "sm", collapsed: { mobile: !mobileNav } }}
        aside={{ width: computerHasDesktop ? { lg: 460, xl: 600 } : 420, breakpoint: "lg", collapsed: { desktop: !showComputer, mobile: true } }}
        padding={0}
      >
        <AppShell.Navbar p="md">
          <Group gap="sm" mb="xl" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap"><BlobAvatar seed="rex-brand" size={46} /><div><Title order={3}>Rex</Title><Text size="xs" c="dimmed">Your AI teammate</Text></div></Group>
            <ActionIcon hiddenFrom="sm" aria-label="Close menu" variant="subtle" size={44} onClick={() => setMobileNav(false)}><IconX /></ActionIcon>
          </Group>
          <ScrollArea style={{ flex: 1 }} offsetScrollbars type="hover">
            <Stack gap={2}>
              <Group justify="space-between" wrap="nowrap" mb="xs"><Text size="xs" c="dimmed" fw={600}>Your bots</Text><Tooltip label="New bot"><ActionIcon aria-label="New bot" size={36} variant="subtle" disabled={busy} onClick={() => { setBotEditor("new"); setMobileNav(false); }}><IconPlus size={20} /></ActionIcon></Tooltip></Group>
              {conversations.length === 0 ? <Text size="sm" c="dimmed" px="xs">Create a bot to give it a name and a look of its own.</Text> : null}
              {conversations.filter((c) => c.kind !== "group").map((c) => (
                <UnstyledButton
                  key={c.id}
                  className={`chat-nav${c.id === activeId ? " active" : ""}`}
                  disabled={busy}
                  onClick={() => void openConversation(c.id).catch((e) => setError(String(e)))}
                >
                  <Group gap="sm" wrap="nowrap">
                    <BlobAvatar
                      seed={c.id}
                      appearance={c.bot}
                      size={40}
                      pulse={c.id === activeId && busy}
                      float={c.id === activeId}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="chat-nav-title">{c.bot?.name ?? c.title}</div>
                      <Text size="xs" c="dimmed" truncate>
                        {c.id === activeId && busy ? "working…" : c.bot ? "Your teammate" : "Conversation"}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
              ))}
              <Group justify="space-between" wrap="nowrap" mt="md" mb="xs"><Text size="xs" c="dimmed" fw={600}>Groups</Text><Tooltip label="New group"><ActionIcon aria-label="New group" size={36} variant="subtle" disabled={busy} onClick={() => { setGroupEditor("new"); setMobileNav(false); }}><IconPlus size={20} /></ActionIcon></Tooltip></Group>
              {!conversations.some((c) => c.kind === "group") ? <Text size="sm" c="dimmed" px="xs">Bring bots together in a group.</Text> : null}
              {conversations.filter((c) => c.kind === "group").map((c) => <UnstyledButton key={c.id} className={`chat-nav${c.id === activeId ? " active" : ""}`} disabled={busy} onClick={() => void openConversation(c.id).catch((e) => setError(String(e)))}><Group gap="sm" wrap="nowrap"><IconGroup size={32} /><div style={{ minWidth: 0, flex: 1 }}><div className="chat-nav-title">{c.title}</div><Text size="xs" c="dimmed">{c.memberIds?.length ?? 0} members</Text></div></Group></UnstyledButton>)}
            </Stack>
          </ScrollArea>
          <Stack gap={6} className="sidebar-footer">
            {busy ? <Group gap="xs" px="sm"><OrbitDots active /><Text size="sm" c="dimmed">Rex is working</Text></Group> : null}
            <Button variant="subtle" color="gray" justify="flex-start" leftSection={<IconBrain />} onClick={() => { setShowMemory(true); setMobileNav(false); }}><Group gap="xs"><span>Memory</span><Text span size="xs" c="dimmed">{memories.length}</Text></Group></Button>
            <Button variant="subtle" color="gray" justify="flex-start" leftSection={<IconClock />} onClick={() => { setShowRoutines(true); setMobileNav(false); }}>Routines</Button>
            <Button variant="subtle" color="gray" justify="flex-start" leftSection={<IconSettings />} onClick={() => { setShowSettings(true); setMobileNav(false); }}>Settings</Button>
            <Menu position="top-start" width={240} withinPortal>
              <Menu.Target>
                <UnstyledButton className="account-button" aria-label="Account menu">
                  <Group gap="sm" wrap="nowrap">
                    <Avatar radius="xl" size={32} color="orange">{initials(session.user.name)}</Avatar>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" fw={500} truncate>{session.user.name}</Text>
                      <Text size="xs" c="dimmed" truncate>{session.user.email}</Text>
                    </div>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconAccount size={18} />} onClick={() => { setShowAccount(true); setMobileNav(false); }}>Account</Menu.Item>
                {session.user.role === "admin" ? <Menu.Item leftSection={<IconAdmin size={18} />} component="a" href="/admin" onClick={(event) => { event.preventDefault(); syncUrl("/admin"); window.dispatchEvent(new PopStateEvent("popstate")); }}>Admin panel</Menu.Item> : null}
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={18} />} onClick={() => void session.signOut()}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Stack>
        </AppShell.Navbar>

        <AppShell.Main>
          <div className={`chat-stage${draggingFiles ? " chat-drop-active" : ""}`}>
            {draggingFiles ? <div className="chat-drop-hint" role="status">Drop images or files to attach them</div> : null}
            <Group
              className="conversation-bar"
              justify="space-between"
              px="md"
              py={8}
            >
              <Button hiddenFrom="sm" variant="subtle" color="gray" leftSection={<IconMenu size={24} />} onClick={() => setMobileNav(true)}>Menu</Button>
              <Group gap="sm">
                <div>
                  <Text fw={500} size="sm" className="conversation-title">
                    {activeTitle}
                  </Text>
                  {busy ? (
                    <Group gap={6}>
                      <OrbitDots active />
                      <Text size="xs" c="dimmed">
                        Rex is working
                      </Text>
                    </Group>
                  ) : null}
                </div>
              </Group>
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Rex Computer"><ActionIcon aria-label="Toggle computer drawer" aria-expanded={showComputer} variant={showComputer ? "light" : "subtle"} size={44} onClick={() => setShowComputer(!showComputer)}><IconComputer size={26} /></ActionIcon></Tooltip>
                {activeId ? <Tooltip label={activeConversation?.kind === "group" ? "Group settings" : "Customize bot"}><ActionIcon aria-label={activeConversation?.kind === "group" ? "Group settings" : "Customize bot"} size={44} variant="subtle" disabled={busy} onClick={() => { if (activeConversation?.kind === "group") setGroupEditor(activeConversation); else if (activeConversation) setBotEditor(activeConversation); }}><IconCustomize size={26} /></ActionIcon></Tooltip> : null}
                {activeId && activeConversation ? (
                  <Tooltip label="Copy link">
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      aria-label="Copy link"
                      onClick={() => {
                        const url = absoluteUrl(conversationPath(activeConversation));
                        void navigator.clipboard.writeText(url).then(() => {
                          notifications.show({ message: "Link copied", autoClose: 1800 });
                        }).catch(() => setError("Could not copy link."));
                      }}
                    >
                      <IconLink size={24} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              {activeId ? (
                <Tooltip label="Delete conversation">
                  <ActionIcon
                    size={44}
                    disabled={busy}
                    variant="subtle"
                    color="red"
                    radius="xl"
                    aria-label="Delete conversation"
                    onClick={() => { if (activeConversation) setDeleteTarget(activeConversation); }}
                  >
                    <IconTrash size={22} stroke={1.5} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              </Group>
            </Group>

            <div className="chat-column">
            <Box ref={threadScrollRef} className={`thread-scroll${thread.length === 0 ? " thread-empty" : ""}`} onScroll={onThreadScroll}>
              <Stack gap="sm" className={thread.length === 0 ? "thread-empty-stack" : "thread-stack"}>
                {thread.length === 0 ? (
                  <Stack className="empty-chat" align="center" justify="center" gap="lg">
                    {activeConversation?.kind === "group" ? <Group justify="center">{activeConversation.memberIds?.map((id) => <BlobAvatar key={id} seed={id} size={72} appearance={conversations.find((c) => c.id === id)?.bot} />)}</Group> : <BlobAvatar seed={activeId ?? "rex-brand"} size={132} appearance={activeBot} />}
                    <Title order={2}>
                      <Text span c="ember" inherit>
                        {activeConversation?.kind === "group" ? activeConversation.title : activeBot.name}
                      </Text>{" "}
                      has room to work.
                    </Title>
                      <Text c="dimmed" ta="center" maw={460} size="lg">
                      {activeConversation?.kind === "group" ? "Use @name to ping a bot, or @everyone to hear from everyone in order. Otherwise, the first member replies." : hasBots ? "Bring a question, a file, or something to figure out." : "Create a bot with its own look, then give it something to work on."}
                    </Text>
                    <Group justify="center" gap="sm">{!hasBots ? <Button leftSection={<IconBotAdd size={24} />} onClick={() => setBotEditor("new")}>Create your first bot</Button> : <Button variant="default" leftSection={<IconSearch size={24} />} onClick={() => setDraft("Search the web for ")}>Research something</Button>}<Button variant="default" leftSection={<IconComputer size={24} />} onClick={() => setShowComputer(true)}>Open Rex Computer</Button></Group>
                  </Stack>
                ) : (
                  <>
                  {visibleThread.map((item) => {
                    if (item.kind === "tool") {
                      const result = item.tool === "computer_exec" ? computerResult(item.detail) : null;
                      return (
                        <details key={item.id} className="tool-row tool-detail msg-in" data-status={item.status}>
                          <summary aria-label={`View ${toolLabels[item.tool] ?? item.tool} activity`}>
                            {item.status === "running" ? <Loader size={16} color="ember" /> : toolIcon(item.tool)}
                            <span className="tool-label">{toolLabels[item.tool] ?? item.tool}</span>
                            <span className="tool-status">{item.status === "running" ? "Working" : item.status === "error" ? "Failed" : "Done"}</span>
                            <IconChevronDown size={14} />
                          </summary>
                          <div className="tool-output">{item.detail ? result ? <><Text size="xs" c="dimmed">Command</Text><pre>{result.command}</pre><Text size="xs" c="dimmed">Output · exit {result.exitCode}{result.timedOut ? " · Timed out" : ""}</Text><pre>{result.output}</pre></> : <pre>{item.detail}</pre> : <Text size="sm" c="dimmed">{item.status === "running" ? "Waiting for the tool to return…" : "No output was returned."}</Text>}</div>
                        </details>
                      );
                    }
                    const m = item.message;
                    const messageBot = conversations.find((c) => c.id === m.botId)?.bot ?? activeBot;
                    if (m.role !== "user" && m.role !== "assistant") return null;
                    if (
                      (!m.content || isEmptyNoiseContent(m.content)) &&
                      m.role === "assistant" &&
                      busy
                    ) {
                      return (
                        <Group
                          key={m.id}
                          className="bubble-assistant msg-in"
                          gap="sm"
                          align="center"
                        >
                          <BlobAvatar
                            seed={activeId ?? "rex-think"}
                              appearance={messageBot}
                            size={32}
                            pulse
                          />
                          <OrbitDots active />
                          <Text c="dimmed" size="sm">
                            thinking…
                          </Text>
                        </Group>
                      );
                    }
                    if ((!m.content || isEmptyNoiseContent(m.content)) && !m.attachments?.length) return null;
                    const isUser = m.role === "user";
                    return (
                      <Paper
                        key={m.id}
                        className={`${isUser ? "bubble-user" : "bubble-assistant"} msg-in`}
                        p="sm"
                        px="md"
                        radius={isUser ? "xl" : "md"}
                        bg={isUser ? "dark.6" : "transparent"}
                        withBorder={isUser}
                      >
                        <Group gap={8} mb={4}>
                          {isUser ? (
                            <BlobAvatar seed="you-user" size={26} />
                          ) : (
                            <BlobAvatar
                              seed={activeId ?? "rex-msg"}
                              appearance={messageBot}
                              size={26}
                              float
                            />
                          )}
                          <Text size="xs" c="dimmed" ff="monospace">
                            {isUser ? "You" : m.botName ?? activeBot.name}
                          </Text>
                        </Group>
                        {m.attachments?.length ? <SentAttachments items={m.attachments} /> : null}
                        {isUser ? (
                          <Text
                            size="md"
                            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                          >
                            {m.content}
                          </Text>
                        ) : (
                          <AssistantReply
                            content={botReplyText(m.content, m.botName ?? activeBot.name)}
                            live={busy && m.id === lastVisibleMessageId}
                          />
                        )}
                        <MessageReactions message={m} enabled={!isUser && !busy} onError={setError} onChange={(reactions) => setThread((prev) => prev.map((entry) => entry.kind === "message" && entry.message.id === m.id ? { ...entry, message: { ...entry.message, reactions } } : entry))} />
                      </Paper>
                    );
                  })}
                  </>
                )}
                <div ref={bottomRef} />
              </Stack>
            </Box>

            <div className="composer-dock">
              <Stack gap={6}>
                {error ? (
                  <Alert color="red" variant="light" p="xs" title="Error">
                    {error}
                  </Alert>
                ) : null}
                {voiceBot ? (
                  <VoiceModal
                    bot={voiceBot}
                    settings={settings}
                    onTranscript={(role, text) => {
                      setThread((prev) => {
                        const last = prev.at(-1);
                        if (last?.kind === "message" && last.message.id.startsWith("voice-live-") && last.message.role === role) {
                          return [...prev.slice(0, -1), { kind: "message", message: { ...last.message, content: last.message.content + text } }];
                        }
                        return [...prev, {
                          kind: "message",
                          message: {
                            id: `voice-live-${role}-${crypto.randomUUID()}`,
                            conversationId: voiceBot.id,
                            role,
                            content: text,
                            createdAt: new Date().toISOString(),
                            ...(role === "assistant" ? { botId: voiceBot.id, botName: voiceBot.bot?.name ?? voiceBot.title } : {}),
                          },
                        }];
                      });
                    }}
                    onClose={() => {
                      const id = voiceBot.id;
                      setVoiceBot(null);
                      void api.getConversation(id).then((data) => setThread(toThread(data.messages))).catch((err) => setError(String(err)));
                      void refreshLists().catch((err) => setError(String(err)));
                    }}
                  />
                ) : null}
                <Paper className="composer-pill" radius="xl" p={6} pl={8} pr={8}>
                  {attachments.items.length ? <DraftAttachments items={attachments.items} onRemove={attachments.remove} onRetry={attachments.retry} /> : null}
                  <Group gap={6} align="flex-end" wrap="nowrap">
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      multiple
                      disabled={busy || Boolean(voiceBot)}
                      onChange={(e) => { if (e.currentTarget.files?.length) { setError(null); attachments.add(Array.from(e.currentTarget.files)); } e.currentTarget.value = ""; }}
                    />
                    <Tooltip label="Attach">
                      <ActionIcon
                        size={48}
                        variant="subtle"
                        radius="xl"
                        disabled={busy || Boolean(voiceBot)}
                        onClick={() => fileRef.current?.click()}
                        aria-label="Attach files"
                      >
                        <IconPaperclip size={26} stroke={1.5} />
                      </ActionIcon>
                    </Tooltip>
                    <MentionInput
                      value={draft}
                      label={activeConversation?.kind === "group" ? `Message ${activeConversation.title}` : `Message ${activeBot.name}`}
                      members={activeConversation?.kind === "group" ? (activeConversation.memberIds ?? []).flatMap((id) => { const member = conversations.find((item) => item.id === id); return member?.bot ? [member] : []; }) : []}
                      disabled={busy || Boolean(voiceBot)}
                      onChange={setDraft}
                      onSend={() => void send()}
                      onPaste={(event) => {
                        const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
                        if (files.length) { event.preventDefault(); setError(null); attachments.add(files); }
                      }}
                    />
                    {activeConversation?.bot ? (
                      <Tooltip label="Live voice">
                        <ActionIcon
                          size={48}
                          variant={voiceBot ? "light" : "subtle"}
                          radius="xl"
                          disabled={busy}
                          onClick={() => setVoiceBot(activeConversation)}
                          aria-label="Live voice"
                        >
                          <IconMic size={24} stroke={1.5} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                    <Tooltip label="Send">
                      <ActionIcon
                        size={48}
                        radius="xl"
                        variant="filled"
                        color="ember"
                        onClick={() => void send()}
                        disabled={busy || Boolean(voiceBot) || (!draft.trim() && !attachments.items.length) || (attachments.items.length > 0 && !attachments.ready)}
                        loading={busy}
                        aria-label="Send"
                      >
                        <IconSend2 size={24} stroke={1.5} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Paper>
              </Stack>
            </div>
            </div>
          </div>
        </AppShell.Main>
        {desktopComputer ? <AppShell.Aside className="computer-aside" p={0} aria-hidden={!showComputer} inert={!showComputer}><ComputerPanel active={showComputer} onClose={() => setShowComputer(false)} bots={computerBots} focusBotId={screenBotId} onStatus={(status) => { if (status.desktop) { setComputerHasDesktop(true); setShowComputer(true); } }} /></AppShell.Aside> : null}

      </AppShell>

        <Drawer opened={showMemory} onClose={() => setShowMemory(false)} closeButtonProps={{ "aria-label": "Close memory" }} title="Memory" position="right" size="md">
          <Group gap="sm" mb="xs">
            <BlobAvatar seed="memory-brain" size={32} float />
            <Text fw={600}>Memory</Text>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            What Rex kept about you
          </Text>
          <ScrollArea style={{ flex: 1 }} offsetScrollbars>
            <Stack gap="sm">
              {memories.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Nothing stored yet.
                </Text>
              ) : (
                memories.map((m) => (
                  <Paper key={m.id} withBorder p="sm" radius="sm">
                    <Group align="flex-start" wrap="nowrap" gap="xs">
                      <Text size="sm" style={{ flex: 1 }}>
                        {m.content}
                      </Text>
                      <ActionIcon
                        size={44}
                        variant="subtle"
                        color="red"
                        aria-label="Delete memory"
                        onClick={() =>
                          void api.deleteMemory(m.id).then(refreshLists).catch((e) => setError(String(e)))
                        }
                      >
                        <IconX size={24} stroke={1.5} />
                      </ActionIcon>
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </ScrollArea>
        </Drawer>

      {!desktopComputer ? <Drawer.Root opened={showComputer} onClose={() => setShowComputer(false)} position="right" size="min(460px, 100vw)" padding={0} keepMounted><Drawer.Overlay /><Drawer.Content aria-label="Rex Computer"><Drawer.Body><ComputerPanel active={showComputer} onClose={() => setShowComputer(false)} bots={computerBots} focusBotId={screenBotId} onStatus={(status) => { if (status.desktop) { setComputerHasDesktop(true); setShowComputer(true); } }} /></Drawer.Body></Drawer.Content></Drawer.Root> : null}

      {groupEditor ? <GroupEditor initial={groupEditor === "new" ? undefined : groupEditor} bots={conversations} onBotCreated={(bot) => setConversations((prev) => [bot, ...prev.filter((c) => c.id !== bot.id)])} onClose={() => setGroupEditor(null)} onSave={(group) => {
        const isNew = groupEditor === "new";
        setGroupEditor(null);
        setConversations((prev) => [group, ...prev.filter((c) => c.id !== group.id)]);
        setActiveId(group.id);
        syncUrl(conversationPath(group), isNew ? "push" : "replace");
        if (isNew) { setThread([]); setDraft(""); attachments.clear(); setError(null); }
      }} /> : null}
      {botEditor ? <BotEditor initial={botEditor === "new" ? undefined : botEditor} existingNames={conversations.filter((bot) => bot.kind !== "group").map((bot) => bot.bot?.name ?? bot.title)} existingColors={conversations.filter((bot) => bot.kind !== "group").map((bot) => bot.bot?.color ?? "")} onClose={() => setBotEditor(null)} onSave={(bot) => {
        const isNew = botEditor === "new";
        setBotEditor(null);
        setConversations((previous) => [bot, ...previous.filter((item) => item.id !== bot.id)]);
        setActiveId(bot.id);
        syncUrl(conversationPath(bot), isNew ? "push" : "replace");
        if (isNew) { setThread([]); setDraft(""); attachments.clear(); setError(null); }
      }} /> : null}

      {deleteTarget ? <DeleteDialog conversation={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => {
        const gone = deleteTarget.id;
        setDeleteTarget(null);
        void refreshLists().then((convs) => {
          const next = convs.find((conversation) => conversation.id !== gone && conversation.kind !== "group") ?? convs.find((conversation) => conversation.id !== gone);
          if (next) return openConversation(next.id);
          newChat();
        }).catch((err) => setError(String(err)));
      }} /> : null}
      <RoutinesDrawer opened={showRoutines} onClose={() => setShowRoutines(false)} conversations={conversations} activeId={activeId} onRan={(conversationId) => { if (conversationId === activeId) void openConversation(conversationId, { history: "none" }); }} />
      {showAccount ? <AccountModal onClose={() => setShowAccount(false)} /> : null}
      {showSettings ? (
        <SettingsModal
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={onSaveSettings}
          onProviders={setProviderState}
        />
      ) : null}
    </>
  );
}
