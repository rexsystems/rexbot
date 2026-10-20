import { useEffect, useState, type FormEvent } from "react";
import { Alert, Anchor, Badge, Button, Group, Paper, PasswordInput, Stack, Text } from "@mantine/core";
import * as api from "./api";
import { ProviderLogo } from "./ProviderLogo";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Connects the user's own Cursor API key so bots can hand repository work to Cursor Cloud Agents. */
export function CursorCard() {
  const [status, setStatus] = useState<api.CursorStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.cursor.status().then(setStatus).catch((err) => setError(errorText(err))); }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { setStatus(await api.cursor.connect(key)); setKey(""); setEditing(false); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Cursor? The key is deleted from this server. Agents already running keep running in Cursor.")) return;
    try { setStatus(await api.cursor.disconnect()); } catch (err) { setError(errorText(err)); }
  }

  return (
    <Paper className={`provider-card${status?.connected ? " active" : ""}`} withBorder radius="md" p="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ProviderLogo provider="cursor" logo="cursor.svg" size={40} />
            <div style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap"><Text fw={500}>Cursor Cloud Agents</Text>{status?.connected ? <Badge size="xs" variant="light">Connected</Badge> : null}</Group>
              <Text size="xs" c="dimmed">
                {status?.connected
                  ? `Key ${status.keyName ? `"${status.keyName}" ` : ""}${status.keyHint ?? ""}. Bots can start agents on your repositories when you ask.`
                  : "Let bots hand coding work on your repositories to Cursor agents, billed to your Cursor plan."}
              </Text>
            </div>
          </Group>
          {status && !editing ? (
            status.connected
              ? <Group gap={4} wrap="nowrap"><Button size="xs" variant="subtle" onClick={() => setEditing(true)}>Replace key</Button><Button size="xs" variant="subtle" color="red" onClick={() => void disconnect()}>Disconnect</Button></Group>
              : <Button size="xs" variant="light" onClick={() => setEditing(true)}>Connect</Button>
          ) : null}
        </Group>
        {editing ? (
          <form onSubmit={(event) => void connect(event)}>
            <Stack gap="xs">
              <PasswordInput
                label="Cursor API key"
                description={<>Create one in <Anchor href="https://cursor.com/dashboard" target="_blank" rel="noreferrer" size="xs">Cursor Dashboard → API Keys</Anchor>. Rex checks it with Cursor and stores it encrypted.</>}
                value={key}
                onChange={(event) => setKey(event.currentTarget.value)}
                autoComplete="off"
                visibilityToggleButtonProps={{ "aria-label": "Toggle key visibility" }}
                required
              />
              <Group justify="flex-end" gap="xs">
                <Button size="xs" variant="subtle" color="gray" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
                <Button size="xs" type="submit" loading={busy} disabled={!key.trim()}>Check and connect</Button>
              </Group>
            </Stack>
          </form>
        ) : null}
        {error ? <Alert color="red" variant="light" role="alert">{error}</Alert> : null}
      </Stack>
    </Paper>
  );
}
