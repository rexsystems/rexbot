import { useEffect, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import type { ComputerResult, ComputerStatus } from "@rex/shared";
import * as api from "./api";
import { IconCollapse, IconComputer, IconPlay, IconRefresh, IconStop, IconTool } from "./icons";

export function ComputerPanel({ onClose, active }: { onClose: () => void; active: boolean }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [command, setCommand] = useState("python -c 'print(\"Hello from Rex Computer\")'");
  const [results, setResults] = useState<ComputerResult[]>([]);

  async function refresh() {
    try { setStatus(await api.computerStatus()); } catch (err) { setError(String(err instanceof Error ? err.message : err)); }
  }
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [active]);

  async function act(action: "start" | "stop" | "exec") {
    setError(null);
    setPending(true);
    try {
      if (action === "exec") {
        const result = await api.execComputer(command);
        setResults((old) => [...old.slice(-9), result]);
      } else {
        setStatus(await (action === "start" ? api.startComputer() : api.stopComputer()));
        if (action === "stop") setResults([]);
      }
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }

  return (
    <section className="computer-panel" aria-label="Rex Computer">
      <Group className="computer-panel-heading" justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap"><IconComputer size={30} /><Text component="h2" fw={600} size="lg" m={0}>Rex Computer</Text></Group><ActionIcon aria-label="Close computer" title="Collapse computer" size={44} variant="subtle" onClick={onClose}><IconCollapse /></ActionIcon></Group>
      <ScrollArea className="computer-panel-scroll" offsetScrollbars>
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
        <ScrollArea.Autosize mah={300}>
          <div className="computer-output" aria-live="polite">
            {results.length === 0 ? <Text size="sm" c="dimmed">Command output will appear here. Rex's commands appear in the conversation.</Text> : results.map((result, i) => <div key={i}><Text size="sm" fw={600}>Exit {result.exitCode}{result.timedOut ? " · Timed out, computer stopped" : ""}</Text><pre>{result.command}</pre><pre>{result.output}</pre></div>)}
          </div>
        </ScrollArea.Autosize>
        <details className="computer-isolation"><summary>Isolation & limits</summary><Stack gap="md"><div className="computer-specs">
          <div><Text fw={600}>512 MB RAM</Text><Text size="sm" c="dimmed">1 CPU · 64 processes</Text></div>
          <div><Text fw={600}>128 MB workspace</Text><Text size="sm" c="dimmed">Deleted when stopped</Text></div>
          <div><Text fw={600}>Offline</Text><Text size="sm" c="dimmed">No host folders or sockets</Text></div>
          <div><Text fw={600}>Rootless Podman</Text><Text size="sm" c="dimmed">Read-only OS · no capabilities</Text></div>
        </div><Text size="sm" c="dimmed">Python 3 and shell, without a desktop or browser yet. Each command has a 20-second limit. The computer stops after one hour. Containers share the host kernel; this is not a virtual machine. All bots share this computer.</Text></Stack></details>
      </Stack>
      </ScrollArea>
    </section>
  );
}
