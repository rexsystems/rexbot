import { useEffect, useState } from "react";
import { ActionIcon, Alert, Button, Group, Loader, Modal, NumberInput, PasswordInput, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import type { ComputerSession, ComputerStatus } from "@rex/shared";
import * as api from "./api";
import { IconCollapse, IconComputer } from "./icons";

export interface ComputerBot { id: string; name: string }

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function ComputerPanel({
  onClose,
  active,
  bots,
  focusBotId,
  onStatus,
}: {
  onClose: () => void;
  active: boolean;
  bots: ComputerBot[];
  focusBotId?: string;
  onStatus?: (status: ComputerStatus) => void;
}) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      let next = await api.computerStatus();
      // Keep the VM up. No shutdown control in the UI.
      if (next.desktop && next.available && !next.running && next.vmState !== "running") {
        try { next = await api.startComputer(); }
        catch (err) { setError(errorText(err)); }
      } else if (next.desktop && next.available && !next.running && next.vmState === "running") {
        // Guest still booting — status alone is enough; session open waits.
      }
      setStatus(next);
      onStatus?.(next);
      if (!next.desktop) setError((old) => old?.startsWith("Status:") ? null : old);
    } catch (err) { setError(`Status: ${errorText(err)}`); }
  }

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <section className="computer-panel" aria-label="Rex Computer">
      <Group className="computer-panel-heading" justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap"><IconComputer size={30} /><Text component="h2" fw={600} size="lg" m={0}>Rex Computer</Text></Group>
        <ActionIcon aria-label="Close computer" title="Collapse computer" size={44} variant="subtle" onClick={onClose}><IconCollapse /></ActionIcon>
      </Group>
      <ScrollArea className="computer-panel-scroll" offsetScrollbars>
        {status?.desktop
          ? <DesktopScreen status={status} error={error} active={active} bots={bots} focusBotId={focusBotId} />
          : <SetupBody error={error} refresh={refresh} />}
      </ScrollArea>
    </section>
  );
}

function SetupBody({ error, refresh }: { error: string | null; refresh: () => Promise<void> }) {
  return (
    <Stack gap="lg">
      <Stack gap={6}>
        <Text fw={600} size="lg">Create the computer</Text>
        <Text c="dimmed" size="sm">Once. Makes one VM named rex-computer on your Proxmox. After that it stays on and each bot gets its own screen.</Text>
      </Stack>
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      <BootstrapForm onDone={refresh} />
    </Stack>
  );
}

function BootstrapForm({ onDone }: { onDone: () => Promise<void> }) {
  const [pveHost, setPveHost] = useState("192.168.100.25");
  const [node, setNode] = useState("origin-mur-1");
  const [vmid, setVmid] = useState<number | "">(180);
  const [storage, setStorage] = useState("hdd1");
  const [ipconfig, setIpconfig] = useState("ip=192.168.100.50/24,gw=192.168.100.1");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function submit() {
    setError(null);
    setPending(true);
    setLog(["Creating the computer…"]);
    try {
      const result = await api.bootstrapComputer({
        pveHost,
        node,
        vmid: typeof vmid === "number" ? vmid : undefined,
        ipconfig,
        storage,
        bridge: "vmbr0",
        pvePassword: password || undefined,
      });
      setLog(result.log);
      setPassword("");
      await onDone();
    } catch (err) { setError(errorText(err)); }
    finally { setPending(false); }
  }

  return (
    <Stack gap="md" className="computer-setup-card">
      <TextInput label="Proxmox host" value={pveHost} onChange={(event) => setPveHost(event.currentTarget.value)} required />
      <PasswordInput label="Root password" description="Once, not saved. Empty if this PC already has SSH as root." value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
      <details className="computer-isolation">
        <summary>Advanced</summary>
        <Stack gap="sm" mt="sm">
          <TextInput label="Node" value={node} onChange={(event) => setNode(event.currentTarget.value)} />
          <NumberInput label="VMID" value={vmid} onChange={(value) => setVmid(typeof value === "number" ? value : "")} min={100} allowDecimal={false} />
          <TextInput label="Storage" value={storage} onChange={(event) => setStorage(event.currentTarget.value)} />
          <TextInput label="Guest network" value={ipconfig} onChange={(event) => setIpconfig(event.currentTarget.value)} />
        </Stack>
      </details>
      {error ? <Alert color="red" title="Setup failed" role="alert">{error}</Alert> : null}
      {log.length ? <div className="computer-output" aria-live="polite"><pre>{log.join("\n")}</pre></div> : null}
      <Button size="md" loading={pending} disabled={!pveHost.trim() || !node.trim()} onClick={() => void submit()}>
        {pending ? "Creating…" : "Create computer"}
      </Button>
    </Stack>
  );
}

function DesktopScreen({
  status,
  error,
  active,
  bots,
  focusBotId,
}: {
  status: ComputerStatus;
  error: string | null;
  active: boolean;
  bots: ComputerBot[];
  focusBotId?: string;
}) {
  const botId = focusBotId && bots.some((bot) => bot.id === focusBotId)
    ? focusBotId
    : bots[0]?.id;
  const bot = bots.find((item) => item.id === botId);
  const [session, setSession] = useState<ComputerSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ready = status.running;

  useEffect(() => {
    setSession(null);
    setSessionError(null);
    setExpanded(false);
  }, [botId]);

  useEffect(() => {
    if (!active || !ready || !botId) return;
    let cancelled = false;
    const open = () => api.computerSession(botId)
      .then((next) => { if (!cancelled) { setSession(next); setSessionError(null); } })
      .catch((err) => { if (!cancelled) setSessionError(errorText(err)); });
    void open();
    const renew = window.setInterval(() => void open(), 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(renew); };
  }, [active, ready, botId]);

  useEffect(() => { if (!ready) setSession(null); }, [ready]);

  if (!bots.length) {
    return <Text size="sm" c="dimmed">Open a bot to see its screen.</Text>;
  }

  return (
    <Stack gap="md">
      <Text fw={600}>{bot?.name ?? "Bot"}</Text>
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      {!status.available ? <Alert color="orange" title="Unavailable">{status.detail}</Alert> : null}
      {!ready ? (
        <div className="computer-screen computer-screen-empty">
          <Loader role="status" aria-label="Starting computer" />
          <Text size="sm" c="dimmed" mt="sm">Starting…</Text>
        </div>
      ) : sessionError ? (
        <Alert color="orange" title="Screen not available">{sessionError}</Alert>
      ) : !session ? (
        <div className="computer-screen computer-screen-empty"><Loader role="status" aria-label="Opening screen" /></div>
      ) : (
        <>
          <button
            type="button"
            className="computer-screen computer-screen-hit"
            style={{ aspectRatio: `${session.width} / ${session.height}` }}
            onClick={() => setExpanded(true)}
            aria-label={`Enlarge ${bot?.name ?? "bot"}'s screen`}
          >
            <iframe
              key={session.viewPath}
              title={`${bot?.name ?? "Bot"}'s screen`}
              src={api.computerViewUrl(session.viewPath)}
              tabIndex={-1}
            />
            <span className="computer-screen-hint">Click to enlarge</span>
          </button>
          <Modal
            opened={expanded}
            onClose={() => setExpanded(false)}
            title={bot?.name ?? "Screen"}
            size="95vw"
            centered
            padding="md"
            classNames={{ body: "computer-expand-body", content: "computer-expand-content" }}
          >
            <div className="computer-screen computer-screen-expanded" style={{ aspectRatio: `${session.width} / ${session.height}` }}>
              <iframe
                key={`${session.viewPath}-full`}
                title={`${bot?.name ?? "Bot"}'s screen (enlarged)`}
                src={api.computerViewUrl(session.viewPath)}
              />
            </div>
          </Modal>
        </>
      )}
    </Stack>
  );
}
