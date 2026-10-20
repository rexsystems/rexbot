import { useEffect, useState } from "react";
import { ActionIcon, Alert, Button, Group, Loader, Modal, ScrollArea, Stack, Text } from "@mantine/core";
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
          : <SetupBody status={status} error={error} refresh={refresh} />}
      </ScrollArea>
    </section>
  );
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
          <Text size="sm" c="dimmed" mt="sm" ta="center" maw={320}>{status.vmState === "running" ? "Booting. The first start of a new computer takes about a minute." : "Starting your computer…"}</Text>
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
