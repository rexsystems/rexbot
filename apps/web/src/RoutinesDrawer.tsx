import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Chip, Drawer, Group, Loader, NumberInput, Paper, ScrollArea, SegmentedControl, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import type { Conversation, Routine, RoutineSchedule } from "@rex/shared";
import * as api from "./api";
import { BlobAvatar } from "./BlobAvatar";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function scheduleText(schedule: RoutineSchedule) {
  if (schedule.kind === "interval") return schedule.hours === 1 ? "Every hour" : `Every ${schedule.hours} hours`;
  const days = schedule.days?.length ? schedule.days.map((day) => DAYS[day]).join(", ") : "Every day";
  return `${days} at ${schedule.time}`;
}

function when(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function RoutineForm({ routine, conversations, defaultConversationId, onSaved, onCancel }: { routine?: Routine; conversations: Conversation[]; defaultConversationId?: string; onSaved: (routine: Routine) => void; onCancel: () => void }) {
  const [conversationId, setConversationId] = useState(routine?.conversationId ?? defaultConversationId ?? conversations[0]?.id ?? "");
  const [title, setTitle] = useState(routine?.title ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [kind, setKind] = useState<RoutineSchedule["kind"]>(routine?.schedule.kind ?? "daily");
  const [time, setTime] = useState(routine?.schedule.kind === "daily" ? routine.schedule.time : "08:00");
  const [days, setDays] = useState<string[]>(routine?.schedule.kind === "daily" ? (routine.schedule.days ?? []).map(String) : []);
  const [hours, setHours] = useState<number>(routine?.schedule.kind === "interval" ? routine.schedule.hours : 6);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeZone = routine?.timeZone ?? browserZone();

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const schedule: RoutineSchedule = kind === "interval" ? { kind, hours } : { kind, time, days: days.map(Number) };
    try {
      const input = { conversationId, title, prompt, schedule, timeZone };
      onSaved(routine ? await api.routines.update(routine.id, input) : await api.routines.create(input));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <Stack gap="sm">
        <Text fw={600}>{routine ? "Edit routine" : "New routine"}</Text>
        <Select label="Who runs it" data={conversations.map((item) => ({ value: item.id, label: item.kind === "group" ? `${item.title} (group)` : item.bot?.name ?? item.title }))} value={conversationId || null} onChange={(value) => setConversationId(value ?? "")} allowDeselect={false} comboboxProps={{ withinPortal: true }} required />
        <TextInput label="Name" value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={80} placeholder="Morning brief" required />
        <Textarea label="What to do" description="Sent to the bot each time, as if you wrote it. It can use its tools and computer." value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} autosize minRows={3} maxRows={10} maxLength={4000} placeholder="Check the top tech news and give me five bullet points." required />
        <SegmentedControl value={kind} onChange={(value) => setKind(value as RoutineSchedule["kind"])} data={[{ value: "daily", label: "At a time" }, { value: "interval", label: "Every few hours" }]} />
        {kind === "daily" ? (
          <>
            <TextInput type="time" label="Time" description={`In ${timeZone}`} value={time} onChange={(event) => setTime(event.currentTarget.value)} required w={160} />
            <div>
              <Text size="sm" fw={500} mb={6}>Days</Text>
              <Chip.Group multiple value={days} onChange={setDays}>
                <Group gap={6}>{DAYS.map((day, index) => <Chip key={day} value={String(index)} size="xs">{day}</Chip>)}</Group>
              </Chip.Group>
              <Text size="xs" c="dimmed" mt={4}>{days.length ? "" : "None picked: runs every day."}</Text>
            </div>
          </>
        ) : (
          <NumberInput label="Repeat every (hours)" min={1} max={168} value={hours} onChange={(value) => setHours(Number(value) || 1)} w={200} />
        )}
        {error ? <Alert color="red" variant="light" role="alert">{error}</Alert> : null}
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!conversationId || !title.trim() || !prompt.trim()}>{routine ? "Save" : "Create"}</Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Scheduled prompts per bot or group: list, create, pause, run now. */
export function RoutinesDrawer({ opened, onClose, conversations, activeId, onRan }: { opened: boolean; onClose: () => void; conversations: Conversation[]; activeId?: string | null; onRan: (conversationId: string) => void }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ routine?: Routine } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const targets = useMemo(() => conversations.filter((item) => item.kind === "group" || item.bot), [conversations]);
  const byId = useMemo(() => new Map(conversations.map((item) => [item.id, item])), [conversations]);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    api.routines.list().then(setRoutines).catch((err) => setError(errorText(err)));
  }, [opened]);

  const replace = (next: Routine) => setRoutines((previous) => [...(previous ?? []).filter((item) => item.id !== next.id), next].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));

  async function toggle(routine: Routine, enabled: boolean) {
    try { replace(await api.routines.update(routine.id, { enabled })); } catch (err) { setError(errorText(err)); }
  }

  async function remove(routine: Routine) {
    if (!window.confirm(`Delete the routine "${routine.title}"? Messages it already posted stay in the chat.`)) return;
    try { await api.routines.remove(routine.id); setRoutines((previous) => (previous ?? []).filter((item) => item.id !== routine.id)); } catch (err) { setError(errorText(err)); }
  }

  async function runNow(routine: Routine) {
    setRunning(routine.id);
    setError(null);
    try {
      const result = await api.routines.run(routine.id);
      replace(result.routine);
      if (!result.ok) setError(result.error ?? "The routine failed. Check its last error and try again.");
      onRan(routine.conversationId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRunning(null);
    }
  }

  return (
    <Drawer opened={opened} onClose={onClose} closeButtonProps={{ "aria-label": "Close routines" }} title="Routines" position="right" size="md">
      <Group gap="sm" mb="xs">
        <BlobAvatar seed="routines-clock" size={32} float />
        <Text fw={600}>Routines</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="md">Prompts your bots run on a schedule. Results land in their chat. You can also ask a bot: "every morning at 8, send me...".</Text>
      {error ? <Alert color="red" variant="light" mb="sm" withCloseButton onClose={() => setError(null)}>{error}</Alert> : null}
      {form ? (
        targets.length
          ? <RoutineForm routine={form.routine} conversations={targets} defaultConversationId={activeId && byId.has(activeId) ? activeId : undefined} onCancel={() => setForm(null)} onSaved={(routine) => { replace(routine); setForm(null); }} />
          : <Alert color="ember" variant="light">Create a bot first. Routines run as one of your bots or groups.</Alert>
      ) : (
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <Stack gap="sm">
            <Button variant="light" onClick={() => setForm({})}>New routine</Button>
            {routines === null ? <Group justify="center" py="md"><Loader size="sm" aria-label="Loading routines" /></Group> : null}
            {routines?.length === 0 ? <Text c="dimmed" size="sm">No routines yet.</Text> : null}
            {routines?.map((routine) => {
              const target = byId.get(routine.conversationId);
              return (
                <Paper key={routine.id} withBorder p="sm" radius="sm">
                  <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <div style={{ minWidth: 0 }}>
                        <Text fw={500} truncate>{routine.title}</Text>
                        <Text size="xs" c="dimmed" truncate>{target ? (target.kind === "group" ? target.title : target.bot?.name ?? target.title) : "Deleted chat"} · {scheduleText(routine.schedule)}</Text>
                      </div>
                      <Switch checked={routine.enabled} onChange={(event) => void toggle(routine, event.currentTarget.checked)} aria-label={routine.enabled ? `Pause ${routine.title}` : `Resume ${routine.title}`} />
                    </Group>
                    <Text size="sm" lineClamp={2}>{routine.prompt}</Text>
                    <Group gap={6}>
                      {routine.enabled && routine.nextRunAt ? <Badge size="xs" variant="light" color="gray">Next {when(routine.nextRunAt)}</Badge> : <Badge size="xs" variant="outline" color="gray">Paused</Badge>}
                      {routine.lastStatus === "ok" ? <Badge size="xs" variant="light" color="green">Ran {when(routine.lastRunAt)}</Badge> : null}
                      {routine.lastStatus === "error" ? <Badge size="xs" variant="light" color="red" title={routine.lastError ?? undefined}>Failed {when(routine.lastRunAt)}</Badge> : null}
                    </Group>
                    {routine.lastStatus === "error" && routine.lastError ? <Text size="xs" c="red.4">{routine.lastError}</Text> : null}
                    <Group gap={4}>
                      <Button size="xs" variant="subtle" loading={running === routine.id} disabled={Boolean(running) && running !== routine.id} onClick={() => void runNow(routine)}>Run now</Button>
                      <Button size="xs" variant="subtle" onClick={() => setForm({ routine })}>Edit</Button>
                      <Button size="xs" variant="subtle" color="red" onClick={() => void remove(routine)}>Delete</Button>
                    </Group>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </ScrollArea>
      )}
    </Drawer>
  );
}
