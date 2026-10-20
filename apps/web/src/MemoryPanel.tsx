import { useEffect, useState } from "react";
import { ActionIcon, Alert, Group, Loader, Paper, Stack, Text, TextInput } from "@mantine/core";
import type { MemoryItem } from "@rex/shared";
import { IconTrash } from "./icons";
import * as api from "./api";

export function MemoryPanel() {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listMemories().then((next) => { if (!cancelled) setItems(next); }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, []);
  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try { await api.deleteMemory(id); setItems((previous) => previous?.filter((item) => item.id !== id) ?? null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setDeleting(null); }
  }
  const matches = items?.filter((item) => item.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Stack gap="sm">
    <Text size="sm" c="dimmed">Saved details your bots use in future conversations. Delete anything you don't want them to remember.</Text>
    <TextInput label="Search memories" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    {error ? <Alert color="red" role="alert">{error}</Alert> : null}
    {!items && !error ? <Loader aria-label="Loading memories" /> : null}
    {items?.length === 0 ? <Text c="dimmed">Nothing stored yet.</Text> : matches?.length === 0 ? <Text c="dimmed">No memories match your search.</Text> : null}
    {matches?.map((item) => <Paper key={item.id} withBorder p="sm" radius="sm"><Group wrap="nowrap" align="flex-start">
      <Text size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{item.content}</Text>
      <ActionIcon size={44} color="red" variant="subtle" aria-label={`Delete memory: ${item.content}`} loading={deleting === item.id} disabled={Boolean(deleting) && deleting !== item.id} onClick={() => void remove(item.id)}><IconTrash size={22} /></ActionIcon>
    </Group></Paper>)}
  </Stack>;
}
