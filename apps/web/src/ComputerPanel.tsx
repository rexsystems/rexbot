import { useEffect, useRef, useState } from "react";
import { useSession } from "./session";
import { ActionIcon, Alert, Button, Group, Loader, Modal, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import type { ComputerResult, ComputerSession, ComputerStatus } from "@rex/shared";
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
      if (next.desktop && next.available && !next.running && (next.vmState === "stopped" || next.vmState === "missing")) {
        try { next = await api.startComputer(); }
        catch (err) { setError(errorText(err)); }
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
        {status?.desktop && status.available
          ? <DesktopScreen status={status} error={error} active={active} bots={bots} focusBotId={focusBotId} />
          : status?.backend === "podman" && status.available ? <SandboxBody status={status} refresh={refresh} />
          : <SetupBody status={status} error={error} refresh={refresh} />}
      </ScrollArea>
    </section>
  );
}

function SandboxBody({ status, refresh }: { status: ComputerStatus; refresh: () => Promise<void> }) {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<ComputerResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "start" | "stop" | "run") {
    setPending(true);
    setError(null);
    try {
      if (action === "run") setResult(await api.execComputer(command));
      else if (action === "start") await api.startComputer();
      else { await api.stopComputer(); setResult(null); }
      await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { setPending(false); }
  }
  return <Stack gap="md">
    <Group justify="space-between"><Text fw={600}>{status.running ? "Running" : "Stopped"}</Text><Button variant="subtle" onClick={() => void refresh()} disabled={pending}>Refresh computer status</Button></Group>
    <Text size="sm" c="dimmed">Python and shell in an isolated, temporary workspace. No network or desktop. Stopping it erases its files.</Text>
    {error ? <Alert color="red" role="alert">{error}</Alert> : null}
    <Button loading={pending} variant="default" onClick={() => void act(status.running ? "stop" : "start")}>{status.running ? "Stop & erase workspace" : "Start computer"}</Button>
    <form onSubmit={(event) => { event.preventDefault(); void act("run"); }}>
      <Stack gap="sm"><Textarea label="Run inside Rex Computer" value={command} onChange={(event) => setCommand(event.currentTarget.value)} autosize minRows={3} maxRows={8} /><Button type="submit" loading={pending} disabled={!status.running || !command.trim()}>Run command</Button></Stack>
    </form>
    {result ? <div className="computer-output"><Text size="sm">Exit {result.exitCode}</Text><pre>{result.output}</pre></div> : null}
  </Stack>;
}

function SetupBody({ status, error, refresh }: { status: ComputerStatus | null; error: string | null; refresh: () => Promise<void> }) {
  if (!status) {
    return error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : <div className="computer-screen computer-screen-empty"><Loader role="status" aria-label="Checking computer" /></div>;
  }
  if (status.setupNeeded) return <ImageSetup detail={status.detail} refresh={refresh} />;
  return (
    <Stack gap="md">
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      <Alert color="orange" title="Rex Computer is unavailable">{status.detail}</Alert>
      <Text size="sm" c="dimmed">The server needs QEMU to give bots a computer. The setup guide is in docs/qemu-computer.md.</Text>
    </Stack>
  );
}

/** First-run state: the shared desktop image has not been built on this server yet. */
function ImageSetup({ detail, refresh }: { detail: string; refresh: () => Promise<void> }) {
  const isAdmin = useSession().user.role === "admin";
  const [build, setBuild] = useState<api.TemplateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = build?.build.running ?? false;

  useEffect(() => {
    let cancelled = false;
    const poll = () => api.computerTemplate().then((next) => { if (!cancelled) setBuild(next); }).catch((err) => { if (!cancelled) setError(errorText(err)); });
    void poll();
    const timer = window.setInterval(() => void poll(), running ? 2000 : 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running]);

  useEffect(() => { if (build?.template) void refresh(); }, [build?.template?.version]);

  async function start() {
    setError(null);
    try { await api.buildComputerTemplate(); setBuild(await api.computerTemplate()); }
    catch (err) { setError(errorText(err)); }
  }

  const problems = build?.host.problems ?? [];
  const blocking = problems.filter((problem) => !problem.startsWith("/dev/kvm"));
  if (!isAdmin) {
    return (
      <Stack gap={6}>
        <Text fw={600} size="lg">{running ? "Your computer is almost ready" : "Computers aren't set up yet"}</Text>
        <Text c="dimmed" size="sm">{running ? "An admin is building the computer image. This panel updates by itself when it's done." : "An admin needs to build the computer image first. Your bots can still chat and search the web."}</Text>
      </Stack>
    );
  }
  return (
    <Stack gap="lg">
      <Stack gap={6}>
        <Text fw={600} size="lg">Build the computer image</Text>
        <Text c="dimmed" size="sm">{detail} Building downloads a Debian cloud image and installs a desktop into it once. After that, every account gets its own VM from this image in seconds.</Text>
      </Stack>
      {problems.map((problem) => <Alert key={problem} color={problem.startsWith("/dev/kvm") ? "yellow" : "red"} variant="light">{problem}</Alert>)}
      {error ? <Alert color="red" title="Build failed to start" role="alert">{error}</Alert> : null}
      {build?.build.error && !running ? <Alert color="red" title="Last build failed" role="alert">{build.build.error}</Alert> : null}
      {build?.build.log.length ? <div className="computer-output" aria-live="polite"><pre>{build.build.log.slice(-14).join("\n")}</pre></div> : null}
      <Button size="md" loading={running} disabled={running || blocking.length > 0 || !build} onClick={() => void start()}>
        {running ? "Building image…" : build?.build.error ? "Retry build" : "Build image"}
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
  const [controlling, setControlling] = useState(false);
  const [changingControl, setChangingControl] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [screenRevision, setScreenRevision] = useState(0);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const expandedFrame = useRef<HTMLIFrameElement>(null);
  const reconnectInFlight = useRef(false);
  const connectionTimer = useRef<number | undefined>(undefined);
  const selectedBot = useRef(botId);
  selectedBot.current = botId;
  const ready = status.running;

  async function reconnect() {
    if (!botId || reconnectInFlight.current) return;
    reconnectInFlight.current = true;
    setReconnecting(true);
    setSessionError(null);
    try {
      const next = await api.computerSession(botId);
      if (selectedBot.current !== botId) return;
      setSession(next);
      setDisconnected(false);
      setScreenRevision((revision) => revision + 1);
    } catch (err) {
      if (selectedBot.current === botId) { setSessionError(errorText(err)); setDisconnected(true); }
    } finally { reconnectInFlight.current = false; setReconnecting(false); }
  }

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.source || (event.source !== previewFrame.current?.contentWindow && event.source !== expandedFrame.current?.contentWindow)) return;
      if (event.data?.type !== "rex-screen-state") return;
      if (event.data.state === "disconnected" || event.data.state === "connected") {
        window.clearTimeout(connectionTimer.current);
        setDisconnected(event.data.state === "disconnected");
      }
      if (event.data.state === "reconnect") void reconnect();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [botId]);

  useEffect(() => {
    if (!session) return;
    setDisconnected(false);
    connectionTimer.current = window.setTimeout(() => setDisconnected(true), 20_000);
    return () => window.clearTimeout(connectionTimer.current);
  }, [expanded, controlling, session?.viewPath, screenRevision]);

  useEffect(() => {
    if (!controlling || !botId) return;
    if (!active || !ready) { setControlling(false); return; }
    const timer = window.setInterval(() => {
      void api.takeComputerControl(botId).catch((err) => {
        setSessionError(errorText(err));
        setControlling(false);
      });
    }, 20_000);
    return () => {
      window.clearInterval(timer);
      void api.releaseComputerControl(botId).catch(() => undefined);
    };
  }, [controlling, botId, active, ready]);

  async function toggleControl() {
    if (!botId) return;
    setChangingControl(true);
    setSessionError(null);
    try {
      if (controlling) await api.releaseComputerControl(botId);
      else await api.takeComputerControl(botId);
      setControlling(!controlling);
      if (!controlling) setExpanded(true);
    } catch (err) { setSessionError(errorText(err)); }
    finally { setChangingControl(false); }
  }

  useEffect(() => {
    setSession(null);
    setSessionError(null);
    setExpanded(false);
    setControlling(false);
    setDisconnected(false);
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

  const viewUrl = session ? new URL(api.computerViewUrl(session.viewPath), window.location.href) : null;
  if (controlling) viewUrl?.searchParams.delete("view_only");
  else viewUrl?.searchParams.set("view_only", "true");
  const previewUrl = viewUrl ? new URL(viewUrl) : null;
  previewUrl?.searchParams.set("view_only", "true");

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600}>{bot?.name ?? "Bot"}</Text>
        <Button variant={controlling ? "filled" : "default"} size="compact-md" disabled={!session || !ready || disconnected || reconnecting} loading={changingControl} onClick={() => void toggleControl()}>{controlling ? "Return control" : "Take control"}</Button>
      </Group>
      <Text size="sm" c="dimmed">{controlling ? "You control the mouse and keyboard. The bot keeps working in the background." : "Watch the bot, or take control to use its computer."}</Text>
      {error ? <Alert color="red" title="Computer error" role="alert">{error}</Alert> : null}
      {!status.available ? <Alert color="orange" title="Unavailable">{status.detail}</Alert> : null}
      {!ready ? (
        <div className="computer-screen computer-screen-empty">
          <Loader role="status" aria-label="Starting computer" />
          <Text size="sm" c="dimmed" mt="sm" ta="center" maw={320}>{status.vmState === "running" ? "Booting. The first start of a new computer takes about a minute." : "Starting your computer…"}</Text>
        </div>
      ) : !session ? (
        sessionError ? <Stack gap="sm"><Alert color="orange" title="Screen not available">{sessionError}</Alert><Button variant="default" loading={reconnecting} onClick={() => void reconnect()}>Disconnected, click to reconnect</Button></Stack> :
        <div className="computer-screen computer-screen-empty"><Loader role="status" aria-label="Opening screen" /></div>
      ) : (
        <>
          {sessionError && !expanded ? <Alert color="orange" title="Computer control">{sessionError}</Alert> : null}
          <button
            type="button"
            className={`computer-screen computer-screen-hit${disconnected ? " computer-screen-disconnected" : ""}`}
            style={{ aspectRatio: `${session.width} / ${session.height}` }}
            onClick={() => disconnected ? void reconnect() : setExpanded(true)}
            disabled={reconnecting}
            aria-label={disconnected ? "Disconnected, click to reconnect" : `Open ${bot?.name ?? "bot"}'s computer`}
          >
            {!expanded ?
            <iframe
              ref={previewFrame}
              key={`${session.viewPath}-${controlling}-${screenRevision}`}
              title={`${bot?.name ?? "Bot"}'s screen`}
              src={previewUrl!.href}
              tabIndex={-1}
              sandbox="allow-scripts"
              inert
            /> : null}
            <span className="computer-screen-hint" role="status">{reconnecting ? "Reconnecting…" : disconnected ? "Disconnected, click to reconnect" : "Click to open computer"}</span>
          </button>
          <Modal
            opened={expanded}
            onClose={() => { setExpanded(false); setControlling(false); }}
            title={<Group><Text>{bot?.name ?? "Screen"}</Text><Button variant="default" disabled={disconnected || reconnecting} loading={changingControl} onClick={() => void toggleControl()}>{controlling ? "Return control" : "Take control"}</Button></Group>}
            size="95vw"
            centered
            padding="md"
            classNames={{ body: "computer-expand-body", content: "computer-expand-content" }}
          >
            {sessionError ? <Alert color="orange" title="Computer connection" mb="sm">{sessionError}</Alert> : null}
            <div className={`computer-screen computer-screen-expanded${controlling ? " computer-screen-controlled" : ""}`} style={{ aspectRatio: `${session.width} / ${session.height}` }}>
              {expanded ? <iframe
                ref={expandedFrame}
                key={`${session.viewPath}-full-${controlling}-${screenRevision}`}
                title={`${bot?.name ?? "Bot"}'s screen (enlarged)`}
                src={viewUrl!.href}
                tabIndex={controlling ? 0 : -1}
                sandbox="allow-scripts"
                inert={!controlling}
              /> : null}
              {disconnected || reconnecting ? <button type="button" className="computer-screen-reconnect" disabled={reconnecting} onClick={() => void reconnect()}>{reconnecting ? "Reconnecting…" : "Disconnected, click to reconnect"}</button> : null}
            </div>
          </Modal>
        </>
      )}
    </Stack>
  );
}
