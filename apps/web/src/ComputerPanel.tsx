import { useEffect, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, NumberInput, PasswordInput, ScrollArea, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import type { ComputerResult, ComputerSession, ComputerStatus } from "@rex/shared";
import * as api from "./api";
import { IconCollapse, IconComputer, IconPlay, IconRefresh, IconStop, IconTool } from "./icons";

export interface ComputerBot { id: string; name: string }

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function ResultList({ results, timeoutNote }: { results: ComputerResult[]; timeoutNote: string }) {
  return (
    <ScrollArea.Autosize mah={300}>
      <div className="computer-output" aria-live="polite">
        {results.length === 0 ? <Text size="sm" c="dimmed">Command output will appear here. Bot commands appear in the conversation.</Text> : results.map((result, i) => <div key={i}><Text size="sm" fw={600}>Exit {result.exitCode}{result.timedOut ? ` · ${timeoutNote}` : ""}</Text><pre>{result.command}</pre><pre>{result.output}</pre></div>)}
      </div>
    </ScrollArea.Autosize>
  );
}

export function ComputerPanel({ onClose, active, bots, focusBotId, onStatus }: { onClose: () => void; active: boolean; bots: ComputerBot[]; focusBotId?: string; onStatus?: (status: ComputerStatus) => void }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await api.computerStatus();
      setStatus(next);
      onStatus?.(next);
      setError((old) => old?.startsWith("Status:") ? null : old);
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
      <Group className="computer-panel-heading" justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap"><IconComputer size={30} /><Text component="h2" fw={600} size="lg" m={0}>Rex Computer</Text></Group><ActionIcon aria-label="Close computer" title="Collapse computer" size={44} variant="subtle" onClick={onClose}><IconCollapse /></ActionIcon></Group>
      <ScrollArea className="computer-panel-scroll" offsetScrollbars>
        {status?.desktop
          ? <DesktopBody status={status} error={error} setError={setError} refresh={refresh} active={active} bots={bots} focusBotId={focusBotId} />
          : <PodmanBody status={status} error={error} setError={setError} refresh={refresh} />}
      </ScrollArea>
    </section>
  );
}

interface BodyProps { status: ComputerStatus | null; error: string | null; setError: (error: string | null) => void; refresh: () => Promise<void> }

function DesktopBody({ status, error, setError, refresh, active, bots, focusBotId }: BodyProps & { status: ComputerStatus; active: boolean; bots: ComputerBot[]; focusBotId?: string }) {
  const [pending, setPending] = useState<"start" | "stop" | "exec" | "unlock" | null>(null);
  const [selected, setSelected] = useState<string | undefined>(focusBotId ?? bots[0]?.id);
  const [session, setSession] = useState<ComputerSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [command, setCommand] = useState("ls -la ~/ && echo \"$DISPLAY\"");
  const [results, setResults] = useState<ComputerResult[]>([]);
  const botIds = bots.map((bot) => bot.id).join(",");
  const bot = bots.find((item) => item.id === selected);
  const ready = status.running;

  useEffect(() => {
    setSelected((old) => focusBotId && bots.some((item) => item.id === focusBotId) ? focusBotId : old && bots.some((item) => item.id === old) ? old : bots[0]?.id);
  }, [botIds, focusBotId]);

  useEffect(() => { setSession(null); setSessionError(null); setResults([]); }, [selected]);

  useEffect(() => {
    if (!active || !ready || !selected) return;
    let cancelled = false;
    const open = () => api.computerSession(selected).then((next) => { if (!cancelled) { setSession(next); setLocked(next.locked); setSessionError(null); } }).catch((err) => { if (!cancelled) setSessionError(errorText(err)); });
    void open();
    const renew = window.setInterval(() => void open(), 5 * 60_000);
    const poll = window.setInterval(() => { void api.computerSessionState(selected).then((state) => { if (!cancelled) setLocked(state.locked); }).catch(() => undefined); }, 2000);
    return () => { cancelled = true; window.clearInterval(renew); window.clearInterval(poll); };
  }, [active, ready, selected]);

  useEffect(() => { if (!ready) setSession(null); }, [ready]);

  async function act(action: "start" | "stop" | "exec" | "unlock") {
    setError(null);
    setPending(action);
    try {
      if (action === "exec") {
        const result = await api.execComputer(command, selected);
        setResults((old) => [...old.slice(-9), result]);
      } else if (action === "unlock") {
        if (selected) setLocked((await api.unlockComputerSession(selected)).locked);
      } else {
        await (action === "start" ? api.startComputer() : api.stopComputer());
        if (action === "stop") { setSession(null); setResults([]); }
      }
      await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { setPending(null); }
  }

  const vmLabel = !status.available ? "Unavailable" : ready ? status.busy ? "Working" : "Running" : status.vmState === "running" ? "Booting" : pending === "start" ? "Starting" : "Off";

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Badge variant="light" color={ready ? "ember" : "gray"} size="lg">{vmLabel}</Badge>
        <ActionIcon aria-label="Refresh computer status" variant="subtle" size={44} onClick={() => void refresh()}><IconRefresh /></ActionIcon>
      </Group>
      <Text c="dimmed">{status.detail}</Text>
      {!status.available ? <Alert color="orange" title="Proxmox not reachable">See scripts/proxmox-rex-computer.md for setup.</Alert> : null}
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      <Group>
        {!ready
          ? <Button leftSection={<IconPlay size={24} />} loading={pending === "start" || status.vmState === "running"} disabled={!status.available || Boolean(pending)} onClick={() => void act("start")}>Start VM</Button>
          : <Button variant="default" leftSection={<IconStop size={24} />} loading={pending === "stop"} disabled={Boolean(pending) || status.busy} onClick={() => void act("stop")}>Shut down VM</Button>}
      </Group>

      {bots.length === 0 ? <Text size="sm" c="dimmed">Open a bot or group to see its screen.</Text> : (
        <Stack gap="sm">
          {bots.length > 1 ? <Select label="Screen" data={bots.map((item) => ({ value: item.id, label: item.name }))} value={selected ?? null} onChange={(value) => value && setSelected(value)} allowDeselect={false} /> : null}
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>{bot?.name ?? "Bot"}'s screen</Text>
            {session ? <Badge variant="light" color={locked ? "orange" : "gray"}>{locked ? "Bot in control" : "You can use it"}</Badge> : null}
          </Group>
          {!ready ? <div className="computer-screen computer-screen-empty"><Text size="sm" c="dimmed">The screen appears when the VM is running.</Text></div>
            : sessionError ? <Alert color="orange" title="Screen not available">{sessionError}</Alert>
            : !session ? <div className="computer-screen computer-screen-empty"><Loader role="status" aria-label="Opening screen" /></div>
            : (
              <div className="computer-screen" style={{ aspectRatio: `${session.width} / ${session.height}` }}>
                <iframe key={session.viewPath} title={`${bot?.name ?? "Bot"}'s screen`} src={api.computerViewUrl(session.viewPath)} />
                {locked ? <div className="computer-lock"><Text size="sm" fw={600}>{bot?.name ?? "The bot"} is using the mouse and keyboard.</Text><Button size="xs" variant="white" color="dark" loading={pending === "unlock"} onClick={() => void act("unlock")}>Take control</Button></div> : null}
              </div>
            )}
        </Stack>
      )}

      {bots.length > 0 ? (
        <form onSubmit={(event) => { event.preventDefault(); void act("exec"); }}>
          <Stack gap="sm">
            <Textarea label={`Run on ${bot?.name ?? "this bot"}'s screen`} description={`Runs as rex in /workspace/bots/${selected ?? "…"}. Shared files are in ./shared.`} value={command} onChange={(event) => setCommand(event.currentTarget.value)} minRows={2} maxRows={8} autosize maxLength={8000} className="computer-command" />
            <Button type="submit" variant="light" leftSection={<IconTool size={24} />} disabled={!ready || !command.trim() || Boolean(pending)} loading={pending === "exec"}>Run command</Button>
          </Stack>
        </form>
      ) : null}
      {results.length ? <ResultList results={results} timeoutNote="Timed out after 5 minutes" /> : null}

      <details className="computer-isolation"><summary>How the shared computer works</summary><Text size="sm" c="dimmed">All bots share one Proxmox VM, and each bot gets its own screen. Bot files live in /workspace/bots/&lt;bot&gt;, shared files in /workspace/shared, and both survive restarts. Bots have passwordless sudo, so they can install packages and change the guest. When a bot moves the mouse or types, its screen becomes view-only for you until it has been idle for a minute or you take control. Commands stop after 5 minutes. Bots start the VM automatically when they need it.</Text></details>
    </Stack>
  );
}

function PodmanBody({ status, error, setError, refresh }: BodyProps) {
  const [pending, setPending] = useState(false);
  const [command, setCommand] = useState("python -c 'print(\"Hello from Rex Computer\")'");
  const [results, setResults] = useState<ComputerResult[]>([]);

  async function act(action: "start" | "stop" | "exec") {
    setError(null);
    setPending(true);
    try {
      if (action === "exec") {
        const result = await api.execComputer(command);
        setResults((old) => [...old.slice(-9), result]);
      } else {
        await (action === "start" ? api.startComputer() : api.stopComputer());
        if (action === "stop") setResults([]);
      }
      await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { setPending(false); }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Badge variant="light" color={status?.running ? "ember" : "gray"} size="lg">{status ? status.running ? status.busy ? "Working" : "Running" : "Stopped" : "Checking Podman"}</Badge>
        <ActionIcon aria-label="Refresh computer status" variant="subtle" size={44} onClick={() => void refresh()}><IconRefresh /></ActionIcon>
      </Group>
      <Text c="dimmed">A temporary Python and shell workspace. Start it here, then ask your bot to use it.</Text>
      {!status ? <Loader role="status" aria-label="Checking container runtime" /> : null}
      {status && !status.available ? <Alert color="orange" title="Runtime unavailable">{status.detail}</Alert> : null}
      {status?.available && !status.imageReady ? <Alert color="orange" title="Image needed"><Text size="sm">Run once in your terminal:</Text><code>podman pull docker.io/library/python:3.13-alpine</code></Alert> : null}
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      <Group>
        {!status?.running ? <Button leftSection={<IconPlay size={24} />} loading={pending} disabled={!status?.available || !status.imageReady || status.busy} onClick={() => void act("start")}>Start computer</Button> : <Button variant="default" leftSection={<IconStop size={24} />} onClick={() => void act("stop")}>Stop & erase workspace</Button>}
      </Group>
      <form onSubmit={(event) => { event.preventDefault(); void act("exec"); }}>
        <Stack gap="sm">
          <Textarea label="Run inside Rex Computer" description="Commands only execute in the container." value={command} onChange={(event) => setCommand(event.currentTarget.value)} minRows={2} maxRows={8} autosize maxLength={8000} className="computer-command" />
          <Button type="submit" variant="light" leftSection={<IconTool size={24} />} disabled={!status?.running || status.busy || !command.trim()} loading={pending && Boolean(status?.running)}>Run command</Button>
        </Stack>
      </form>
      <ResultList results={results} timeoutNote="Timed out, computer stopped" />
      <BootstrapForm onDone={refresh} />
      <details className="computer-isolation"><summary>Isolation & limits</summary><Stack gap="md"><div className="computer-specs">
        <div><Text fw={600}>512 MB RAM</Text><Text size="sm" c="dimmed">1 CPU · 64 processes</Text></div>
        <div><Text fw={600}>128 MB workspace</Text><Text size="sm" c="dimmed">Deleted when stopped</Text></div>
        <div><Text fw={600}>Offline</Text><Text size="sm" c="dimmed">No host folders or sockets</Text></div>
        <div><Text fw={600}>Rootless Podman</Text><Text size="sm" c="dimmed">Read-only OS · no capabilities</Text></div>
      </div><Text size="sm" c="dimmed">Python 3 and shell, without a desktop or browser. Each command has a 20-second limit. The computer stops after one hour. Containers share the host kernel; this is not a virtual machine. All bots share this computer. Prefer the Proxmox setup above for per-bot desktops.</Text></Stack></details>
    </Stack>
  );
}

function BootstrapForm({ onDone }: { onDone: () => Promise<void> }) {
  const [pveHost, setPveHost] = useState("192.168.100.25");
  const [node, setNode] = useState("pve");
  const [vmid, setVmid] = useState<number | "">(180);
  const [ipconfig, setIpconfig] = useState("ip=192.168.100.50/24,gw=192.168.100.1");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function submit() {
    setError(null);
    setPending(true);
    setLog(["Starting… this can take a few minutes (cloud image download + apt)."]);
    try {
      const result = await api.bootstrapComputer({
        pveHost,
        node,
        vmid: typeof vmid === "number" ? vmid : undefined,
        ipconfig,
        pvePassword: password || undefined,
      });
      setLog(result.log);
      setPassword("");
      await onDone();
    } catch (err) { setError(errorText(err)); }
    finally { setPending(false); }
  }

  return (
    <details className="computer-isolation" open>
      <summary>Set up Proxmox desktop (one click)</summary>
      <Stack gap="md" mt="sm">
        <Text size="sm" c="dimmed">Rex SSHes into Proxmox as root, creates only a new VM named rex-computer, installs the guest, writes `.env`, and switches itself over. Your other VMs are never touched. Prefer `ssh-copy-id root@proxmox` once; otherwise paste the root password (needs `sshpass` on this machine).</Text>
        <TextInput label="Proxmox host" value={pveHost} onChange={(event) => setPveHost(event.currentTarget.value)} required />
        <TextInput label="Node name" description="Name in the Proxmox tree" value={node} onChange={(event) => setNode(event.currentTarget.value)} required />
        <NumberInput label="VMID" description="Must be free. Leave as-is unless you already use 180." value={vmid} onChange={(value) => setVmid(typeof value === "number" ? value : "")} min={100} allowDecimal={false} />
        <TextInput label="Guest network" description="Static IP is easiest. Use ip=dhcp to discover via guest agent." value={ipconfig} onChange={(event) => setIpconfig(event.currentTarget.value)} />
        <PasswordInput label="Proxmox root password" description="Optional if your SSH key already logs in as root." value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
        {error ? <Alert color="red" title="Bootstrap failed" role="alert">{error}</Alert> : null}
        {log.length ? <div className="computer-output" aria-live="polite"><pre>{log.join("\n")}</pre></div> : null}
        <Button loading={pending} disabled={!pveHost.trim() || !node.trim()} onClick={() => void submit()}>Create rex-computer and wire Rex</Button>
      </Stack>
    </details>
  );
}
