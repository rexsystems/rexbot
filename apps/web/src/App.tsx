import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { DEFAULT_BOT } from "@rex/shared";
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
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
  IconCustomize,
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
  formatToolDetail,
  isEmptyNoiseContent,
  MarkdownMessage,
} from "./MarkdownMessage";
import { loadSettings, saveSettings } from "./settings";
import { SettingsModal } from "./SettingsModal";
import { ComputerPanel } from "./ComputerPanel";
import { MessageReactions } from "./MessageReactions";
import { BotEditor } from "./BotEditor";
import { DraftAttachments, SentAttachments } from "./Attachments";
import { useAttachments } from "./useAttachments";

const ICON_LG = 28;

type ThreadItem =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "tool";
      id: string;
      tool: string;
      status: "running" | "done" | "error";
      detail?: string;
    };

function uid() {
  return Math.random().toString(36).slice(2);
}

function toThread(messages: ChatMessage[]): ThreadItem[] {
  return messages.filter((message) => message.toolName !== "react_message").map((message): ThreadItem => {
    if (message.role !== "tool") return { kind: "message", message };
    const result = message.toolName === "computer_exec" ? computerResult(message.content) : null;
    const failed = message.content.startsWith("computer_exec failed:") || Boolean(result && result.exitCode !== 0);
    return { kind: "tool", id: message.id, tool: message.toolName ?? "tool", status: failed ? "error" : "done", detail: message.content };
  });
}

function toolIcon(tool: string) {
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

const toolLabels: Record<string, string> = { computer_exec: "Rex Computer", web_search: "Web search", http_fetch: "Read webpage", read_upload: "Read attachment" };

export function App() {
  const [settings, setSettings] = useState<ClientSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [botEditor, setBotEditor] = useState<Conversation | "new" | null>(null);
  const desktopComputer = useMediaQuery("(min-width: 75em)");
  const [showMemory, setShowMemory] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const activeBot = activeConversation?.bot ?? DEFAULT_BOT;

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape" && !botEditor && !showSettings && !showMemory) {
        setShowComputer(false);
        setMobileNav(false);
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [botEditor, showSettings, showMemory]);

  const refreshLists = useCallback(async () => {
    const [convs, mems] = await Promise.all([
      api.listConversations(),
      api.listMemories(),
    ]);
    setConversations(convs);
    setMemories(mems);
  }, []);

  useEffect(() => {
    void refreshLists().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [refreshLists]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, busy]);

  const openConversation = async (id: string) => {
    setError(null);
    setActiveId(id);
    attachments.clear();
    const data = await api.getConversation(id);
    setThread(toThread(data.messages));
    setMobileNav(false);
  };

  const newChat = () => {
    setActiveId(undefined);
    setThread([]);
    attachments.clear();
    setDraft("");
    setError(null);
    setMobileNav(false);
  };

  const onSaveSettings = (next: ClientSettings) => {
    setSettings(next);
    saveSettings(next);
    setShowSettings(false);
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.items.length) || busy || (attachments.items.length > 0 && !attachments.ready)) return;
    if (!settings.llmApiKey.trim()) {
      setShowSettings(true);
      setError("Add your LLM API key in Settings first.");
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
            const id = uid();
            const previousId = streamingAssistantId;
            const nextId = uid();
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
                  (ev.tool === "computer_exec" ? ev.output : formatToolDetail(ev.output)) ??
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

  return (
    <>
      <AppShell
        onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; if (!busy) setDraggingFiles(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; } }}
        onDragLeave={(event) => { if (event.dataTransfer.types.includes("Files")) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false); } }}
        onDrop={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (!busy) { setError(null); attachments.add(Array.from(event.dataTransfer.files)); } } }}
        className="app-shell"
        navbar={{ width: 290, breakpoint: "sm", collapsed: { mobile: !mobileNav } }}
        aside={{ width: 420, breakpoint: "lg", collapsed: { desktop: !showComputer, mobile: true } }}
        padding={0}
      >
        <AppShell.Navbar p="md">
          <Group gap="sm" mb="xl" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap"><BlobAvatar seed="rex-brand" size={46} /><div><Title order={3}>Rex</Title><Text size="xs" c="dimmed">Your AI teammate</Text></div></Group>
            <ActionIcon hiddenFrom="sm" aria-label="Close menu" variant="subtle" size={44} onClick={() => setMobileNav(false)}><IconX /></ActionIcon>
          </Group>
          <Button
            fullWidth
            mb="md"
            radius="md"
            leftSection={<IconBotAdd size={28} />}
            onClick={() => { setBotEditor("new"); setMobileNav(false); }}
            disabled={busy}
            size="md"
          >
            New bot
          </Button>
          <Text size="xs" c="dimmed" fw={600} mb="sm">Your bots</Text>
          <ScrollArea style={{ flex: 1 }} offsetScrollbars type="hover">
            <Stack gap={2}>
              {conversations.length === 0 ? <Text size="sm" c="dimmed" px="xs">Create a bot to give it a name and a look of its own.</Text> : null}
              {conversations.map((c) => (
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
            </Stack>
          </ScrollArea>
          <Stack gap={6} className="sidebar-footer">
            {busy ? <Group gap="xs" px="sm"><OrbitDots active /><Text size="sm" c="dimmed">Rex is working</Text></Group> : null}
            <Button variant="subtle" color="gray" justify="flex-start" leftSection={<IconBrain />} onClick={() => { setShowMemory(true); setMobileNav(false); }}><Group gap="xs"><span>Memory</span><Text span size="xs" c="dimmed">{memories.length}</Text></Group></Button>
            <Button variant="subtle" color="gray" justify="flex-start" leftSection={<IconSettings />} onClick={() => { setShowSettings(true); setMobileNav(false); }}>Settings</Button>
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
                        Rex e pe treabă
                      </Text>
                    </Group>
                  ) : null}
                </div>
              </Group>
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Rex Computer"><ActionIcon aria-label="Toggle computer drawer" aria-expanded={showComputer} variant={showComputer ? "light" : "subtle"} size={44} onClick={() => setShowComputer(!showComputer)}><IconComputer size={26} /></ActionIcon></Tooltip>
                {activeId ? <Tooltip label="Customize bot"><ActionIcon aria-label="Customize bot" size={44} variant="subtle" disabled={busy} onClick={() => { if (activeConversation) setBotEditor(activeConversation); }}><IconCustomize size={26} /></ActionIcon></Tooltip> : null}
              {activeId ? (
                <Tooltip label="Delete conversation">
                  <ActionIcon
                    size={44}
                    disabled={busy}
                    variant="subtle"
                    color="red"
                    radius="xl"
                    aria-label="Delete conversation"
                    onClick={() =>
                      void api.deleteConversation(activeId).then(() => {
                        newChat();
                        return refreshLists();
                      }).catch((e) => setError(String(e)))
                    }
                  >
                    <IconTrash size={22} stroke={1.5} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              </Group>
            </Group>

            <Box className="thread-scroll">
              <Stack gap="sm">
                {thread.length === 0 ? (
                  <Stack className="empty-chat" align="center" justify="center" gap="lg">
                    <BlobAvatar seed={activeId ?? "rex-brand"} size={132} appearance={activeBot} />
                    <Title order={2}>
                      <Text span c="ember" inherit>
                        {activeBot.name}
                      </Text>{" "}
                      has room to work.
                    </Title>
                      <Text c="dimmed" ta="center" maw={460} size="lg">
                      {activeId ? "Bring a question, a file, or something to figure out." : "Create a bot with its own look, then give it something to work on."}
                    </Text>
                    <Group justify="center" gap="sm">{!activeId ? <Button leftSection={<IconBotAdd size={24} />} onClick={() => setBotEditor("new")}>Create your first bot</Button> : <Button variant="default" leftSection={<IconSearch size={24} />} onClick={() => setDraft("Search the web for ")}>Research something</Button>}<Button variant="default" leftSection={<IconComputer size={24} />} onClick={() => setShowComputer(true)}>Open Rex Computer</Button></Group>
                  </Stack>
                ) : (
                  thread.map((item) => {
                    if (item.kind === "tool") {
                      const result = item.tool === "computer_exec" ? computerResult(item.detail) : null;
                      return (
                        <Paper
                          key={item.id}
                          className="tool-row msg-in"
                          p="xs"
                          px="sm"
                          radius="xl"
                          bg="dark.7"
                        >
                          <Group gap="sm" wrap="nowrap">
                            {item.status === "running" ? (
                              <Loader size="sm" color="ember" />
                            ) : (
                              toolIcon(item.tool)
                            )}
                            <div style={{ minWidth: 0 }}>
                              <Badge
                                size="sm"
                                color={
                                  item.status === "error"
                                    ? "red"
                                    : item.status === "running"
                                      ? "yellow"
                                      : "teal"
                                }
                                variant="light"
                              >
                                {item.status === "running" ? "running" : item.status} ·{" "}
                                {toolLabels[item.tool] ?? item.tool}
                              </Badge>
                              {item.detail ? <details className="tool-detail"><summary>View activity</summary>{result ? <><Text size="xs" c="dimmed">Command</Text><pre>{result.command}</pre><Text size="xs" c="dimmed">Output · exit {result.exitCode}{result.timedOut ? " · Timed out" : ""}</Text><pre>{result.output}</pre></> : <pre>{item.detail}</pre>}</details> : null}
                            </div>
                          </Group>
                        </Paper>
                      );
                    }
                    const m = item.message;
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
                              appearance={activeBot}
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
                              appearance={activeBot}
                              size={26}
                              float
                            />
                          )}
                          <Text size="xs" c="dimmed" ff="monospace">
                            {isUser ? "You" : activeBot.name}
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
                          <MarkdownMessage content={m.content} />
                        )}
                        <MessageReactions message={m} enabled={!isUser && !busy} onError={setError} onChange={(reactions) => setThread((prev) => prev.map((entry) => entry.kind === "message" && entry.message.id === m.id ? { ...entry, message: { ...entry.message, reactions } } : entry))} />
                      </Paper>
                    );
                  })
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
                <Paper className="composer-pill" radius="xl" p={6} pl={8} pr={8}>
                  {attachments.items.length ? <DraftAttachments items={attachments.items} onRemove={attachments.remove} onRetry={attachments.retry} /> : null}
                  <Group gap={6} align="flex-end" wrap="nowrap">
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      multiple
                      disabled={busy}
                      onChange={(e) => { if (e.currentTarget.files?.length) { setError(null); attachments.add(Array.from(e.currentTarget.files)); } e.currentTarget.value = ""; }}
                    />
                    <Tooltip label="Attach">
                      <ActionIcon
                        size={48}
                        variant="subtle"
                        radius="xl"
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                        aria-label="Attach files"
                      >
                        <IconPaperclip size={26} stroke={1.5} />
                      </ActionIcon>
                    </Tooltip>
                    <Textarea
                      style={{ flex: 1 }}
                      value={draft}
                      aria-label="Message Rex"
                      placeholder="Message Rex…"
                      minRows={1}
                      maxRows={6}
                      autosize
                      variant="unstyled"
                      disabled={busy}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      onPaste={(event) => {
                        const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
                        if (files.length) { event.preventDefault(); setError(null); attachments.add(files); }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <Tooltip label="Send">
                      <ActionIcon
                        size={48}
                        radius="xl"
                        variant="filled"
                        color="ember"
                        onClick={() => void send()}
                        disabled={busy || (!draft.trim() && !attachments.items.length) || (attachments.items.length > 0 && !attachments.ready)}
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
        </AppShell.Main>
        {desktopComputer ? <AppShell.Aside className="computer-aside" p={0} aria-hidden={!showComputer} inert={!showComputer}><ComputerPanel active={showComputer} onClose={() => setShowComputer(false)} /></AppShell.Aside> : null}

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

      {!desktopComputer ? <Drawer.Root opened={showComputer} onClose={() => setShowComputer(false)} position="right" size="min(460px, 100vw)" padding={0} keepMounted><Drawer.Overlay /><Drawer.Content aria-label="Rex Computer"><Drawer.Body><ComputerPanel active={showComputer} onClose={() => setShowComputer(false)} /></Drawer.Body></Drawer.Content></Drawer.Root> : null}

      {botEditor ? <BotEditor initial={botEditor === "new" ? undefined : botEditor} onClose={() => setBotEditor(null)} onSave={(bot) => {
        const isNew = botEditor === "new";
        setBotEditor(null);
        setConversations((previous) => [bot, ...previous.filter((item) => item.id !== bot.id)]);
        setActiveId(bot.id);
        if (isNew) { setThread([]); setDraft(""); attachments.clear(); setError(null); }
      }} /> : null}

      {showSettings ? (
        <SettingsModal
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={onSaveSettings}
        />
      ) : null}
    </>
  );
}
