import { useEffect, useState, type FormEvent } from "react";
import { ActionIcon, Alert, Button, Group, Loader, Modal, MultiSelect, Paper, Stack, Tabs, Text, TextInput, Tooltip } from "@mantine/core";
import type { BotExchange, Conversation } from "@rex/shared";
import { groupExchanges, saveGroup } from "./api";
import { MarkdownMessage } from "./MarkdownMessage";
import { BotEditor } from "./BotEditor";
import { IconPlus } from "./icons";

export function GroupEditor({ initial, bots, onBotCreated, onClose, onSave }: { initial?: Conversation; bots: Conversation[]; onBotCreated: (bot: Conversation) => void; onClose: () => void; onSave: (group: Conversation) => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [members, setMembers] = useState(initial?.memberIds ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<BotExchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);

  async function loadExchanges() {
    if (!initial) return;
    setLoading(true);
    setError(null);
    try { setExchanges(await groupExchanges(initial.id)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadExchanges(); }, [initial?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try { onSave(await saveGroup(title, members, initial?.id)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }

  if (creatingBot) return <BotEditor existingNames={bots.filter((bot) => !bot.kind).map((bot) => bot.bot?.name ?? bot.title)} onClose={() => setCreatingBot(false)} onSave={(bot) => { onBotCreated(bot); setMembers((prev) => [...prev, bot.id]); setCreatingBot(false); }} />;

  return <Modal opened onClose={onClose} title={initial ? "Group settings" : "New group"} closeButtonProps={{ "aria-label": "Close group settings" }} size="lg" centered>
    <Tabs defaultValue="members">
      <Tabs.List mb="md"><Tabs.Tab value="members">Members</Tabs.Tab>{initial ? <Tabs.Tab value="private">Private messages</Tabs.Tab> : null}</Tabs.List>
      {error ? <Alert role="alert" color="red" title="Could not update group" mb="md">{error}</Alert> : null}
      <Tabs.Panel value="members"><form onSubmit={(event) => void submit(event)}><Stack>
        <TextInput label="Group name" placeholder="Name this group" value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={64} required />
        <MultiSelect label="Group members" description="Choose 2-6 bots. The first replies by default; use @name or @everyone in chat." placeholder="Choose bots" data={bots.filter((bot) => bot.bot && !bot.kind).map((bot) => ({ value: bot.id, label: bot.bot!.name }))} value={members} onChange={setMembers} searchable maxValues={6} hidePickedOptions nothingFoundMessage="No matching bots" comboboxProps={{ withinPortal: false }} />
        <Group justify="space-between"><Text size="sm" c="dimmed">Or create a bot for this group.</Text><Tooltip label="New bot for this group"><ActionIcon aria-label="New bot for this group" size={36} variant="default" disabled={members.length >= 6} onClick={() => setCreatingBot(true)}><IconPlus size={20} /></ActionIcon></Tooltip></Group>
        <Text size="sm" c="dimmed">Members can ask each other for help privately, including from their own chats. Those exchanges appear in this group's private-message log. Bots only receive the task context passed to them.</Text>
        {bots.filter((bot) => bot.bot).length < 2 ? <Text size="sm">Create at least two bots before making a group.</Text> : null}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button type="submit" loading={pending} disabled={!title.trim() || members.length < 2 || members.length > 6}>{initial ? "Save group" : "Create group"}</Button></Group>
      </Stack></form></Tabs.Panel>
      {initial ? <Tabs.Panel value="private"><Stack>
        <Group justify="space-between"><Text size="sm" c="dimmed">Bot-to-bot messages, visible to you.</Text><Button variant="default" size="compact-md" onClick={() => void loadExchanges()} disabled={loading}>Refresh messages</Button></Group>
        {loading ? <Group role="status"><Loader size="sm" /><Text>Loading private messages…</Text></Group> : exchanges.length === 0 ? <Text c="dimmed">No private messages yet. Ask a member to contact another bot, or let it request help while working.</Text> : exchanges.map((exchange) => <Paper key={exchange.id} withBorder p="md" radius="md" className="exchange-card"><Stack gap="xs">
          <Text fw={600}>{exchange.fromName} to {exchange.toName}</Text>
          <Text size="xs" c="dimmed">{new Date(exchange.createdAt).toLocaleString()}</Text>
          <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{exchange.message}</Text>
          <Text fw={600} size="sm">{exchange.toName}'s reply</Text>
          <MarkdownMessage content={exchange.reply} />
        </Stack></Paper>)}
      </Stack></Tabs.Panel> : null}
    </Tabs>
  </Modal>;
}
