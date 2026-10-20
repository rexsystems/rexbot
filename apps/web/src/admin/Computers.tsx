import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, NumberInput, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AdminComputer } from "@rex/shared";
import * as api from "../api";
import { errorText, formatBytes, formatDateTime, formatWhen, STATE_COLORS } from "./format";
import { useLoad } from "./useLoad";

type Dialog = { kind: "resources" | "serial" | "reset"; computer: AdminComputer } | null;

export function Computers() {
  const [fast, setFast] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.admin.computers(), [], fast ? 2_000 : 10_000);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const building = data?.build.running ?? false;
  useEffect(() => setFast(building), [building]);

  async function act(computer: AdminComputer, action: "start" | "stop" | "kill", done: string) {
    setBusy(`${computer.ownerId}:${action}`);
    try {
      await api.admin.computerAction(computer.ownerId, action);
      notifications.show({ message: done });
    } catch (err) {
      notifications.show({ color: "red", title: "That didn't work", message: errorText(err) });
    } finally {
      setBusy(null);
      void reload();
    }
  }

  if (loading && !data) return <Group justify="center" py="xl"><Loader aria-label="Loading computers" /></Group>;
  if (!data) return <Alert color="red" variant="light" title="Could not load computers">{error}</Alert>;

  if (data.kind === "podman") {
    return (
      <Alert color="gray" variant="light" title="Podman sandboxes">
        This server runs the offline Podman sandbox (<code>REX_COMPUTER_BACKEND=podman</code>): each account gets a
        command-line container and no screen. Switch to QEMU for full desktops; see <code>docs/qemu-computer.md</code>.
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <ImageCard state={data} onBuilt={() => void reload()} />
      <Stack gap="sm">
        <Title order={3} size="h4">Computers</Title>
        {data.computers.length === 0 ? (
          <Text c="dimmed">No one has a computer yet. Each account gets one the first time a bot uses it.</Text>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table className="admin-table" verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Owner</Table.Th>
                  <Table.Th>State</Table.Th>
                  <Table.Th>Resources</Table.Th>
                  <Table.Th>Disk used</Table.Th>
                  <Table.Th>Image</Table.Th>
                  <Table.Th>Last started</Table.Th>
                  <Table.Th><span className="visually-hidden">Actions</span></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.computers.map((computer) => (
                  <Table.Tr key={computer.ownerId}>
                    <Table.Td>
                      <Text size="sm" fw={500}>{computer.ownerName ?? "Deleted user"}</Text>
                      <Text size="xs" c="dimmed">{computer.ownerEmail ?? computer.name}</Text>
                    </Table.Td>
                    <Table.Td><Badge variant="light" color={STATE_COLORS[computer.state] ?? "gray"}>{computer.state}</Badge></Table.Td>
                    <Table.Td><Text size="sm">{computer.cores} CPU · {formatBytes(computer.memoryMb * 1024 ** 2)} · {computer.diskGb} GB</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatBytes(computer.diskUsedBytes)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{computer.templateVersion ? `v${computer.templateVersion}` : "Not created"}</Text></Table.Td>
                    <Table.Td><Text size="sm" title={formatDateTime(computer.lastStartedAt)}>{formatWhen(computer.lastStartedAt)}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        {computer.state === "running" ? (
                          <Button size="xs" variant="light" color="gray" loading={busy === `${computer.ownerId}:stop`} onClick={() => void act(computer, "stop", "Shutting the computer down.")}>Shut down</Button>
                        ) : (
                          <Button size="xs" variant="light" loading={busy === `${computer.ownerId}:start`} onClick={() => void act(computer, "start", "Computer is booting.")}>Start</Button>
                        )}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" size={36} aria-label={`More for ${computer.ownerName ?? computer.name}`}><Text fw={700} aria-hidden>⋯</Text></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => setDialog({ kind: "resources", computer })}>Change resources…</Menu.Item>
                            <Menu.Item onClick={() => setDialog({ kind: "serial", computer })}>Boot log</Menu.Item>
                            <Menu.Item disabled={computer.state !== "running"} onClick={() => void act(computer, "kill", "Computer was powered off.")}>Force power off</Menu.Item>
                            <Menu.Divider />
                            <Menu.Item color="red" onClick={() => setDialog({ kind: "reset", computer })}>Reset to a fresh disk…</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
      {dialog?.kind === "resources" ? <Resources computer={dialog.computer} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void reload(); }} /> : null}
      {dialog?.kind === "serial" ? <SerialLog computer={dialog.computer} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "reset" ? <ResetComputer computer={dialog.computer} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload(); }} /> : null}
    </Stack>
  );
}

function ImageCard({ state, onBuilt }: { state: api.TemplateState; onBuilt: () => void }) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const log = useRef<HTMLPreElement>(null);
  const { host, template, build } = state;
  const ready = !host.problems.some((problem) => !problem.includes("software emulation"));

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [build.log.length]);

  async function start(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api.admin.buildTemplate(url.trim() || undefined);
      onBuilt();
    } catch (err) {
      notifications.show({ color: "red", title: "The build didn't start", message: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Paper className="admin-card" withBorder radius="md" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={3} size="h4">Computer image</Title>
            <Text size="sm" c="dimmed">Every new computer starts as a copy of this image. Rebuilding never touches existing computers.</Text>
          </div>
          <Badge variant="light" size="lg" color={host.accel === "kvm" ? "green" : "yellow"}>{host.accel === "kvm" ? "KVM" : "Software emulation"}</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
          <div><Text size="xs" c="dimmed">Version</Text><Text fw={500}>{template ? `v${template.version}` : "Not built"}</Text></div>
          <div><Text size="xs" c="dimmed">Built</Text><Text fw={500}>{template ? formatDateTime(template.builtAt) : "Never"}</Text></div>
          <div><Text size="xs" c="dimmed">Size</Text><Text fw={500}>{template ? formatBytes(template.sizeBytes) : "None"}</Text></div>
        </SimpleGrid>
        {host.problems.length ? (
          <Alert color={ready ? "yellow" : "red"} variant="light" title={ready ? "Works, but slowly" : "This server isn't ready for QEMU"}>
            <Stack gap={4}>{host.problems.map((problem) => <Text key={problem} size="sm">{problem}</Text>)}</Stack>
            {!ready ? <Text size="sm" mt="xs">Run <code>scripts/qemu/setup-host.sh</code> on the server, then reload this page.</Text> : null}
          </Alert>
        ) : null}
        {build.error && !build.running ? <Alert color="red" variant="light" title="The last build failed">{build.error}</Alert> : null}
        <form onSubmit={(event) => void start(event)}>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="Base cloud image (optional)"
              description="Leave empty for Debian 13. Any Debian-based cloud image with cloud-init works."
              placeholder="Debian 13 genericcloud (default)"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              disabled={build.running}
              style={{ flex: "1 1 320px" }}
            />
            <Button type="submit" loading={pending} disabled={build.running || !ready}>{build.running ? "Building…" : template ? "Rebuild image" : "Build image"}</Button>
          </Group>
        </form>
        {build.log.length ? (
          <Stack gap={4}>
            <Group gap="xs">{build.running ? <Loader size="xs" /> : null}<Text size="sm" fw={500}>{build.running ? "Build log" : `Last build${build.finishedAt ? `, finished ${formatWhen(build.finishedAt)}` : ""}`}</Text></Group>
            <pre ref={log} className="admin-log" aria-live="polite">{build.log.join("\n")}</pre>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function Resources({ computer, onClose, onSaved }: { computer: AdminComputer; onClose: () => void; onSaved: () => void }) {
  const [memory, setMemory] = useState<number | string>(computer.memoryMb / 1024);
  const [cores, setCores] = useState<number | string>(computer.cores);
  const [disk, setDisk] = useState<number | string>(computer.diskGb);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.admin.resizeComputer(computer.ownerId, { memoryMb: Math.round(Number(memory) * 1024), cores: Number(cores), diskGb: Number(disk) });
      notifications.show({ message: computer.state === "running" ? "Saved. The new resources apply after the next restart." : "Saved. They apply on the next start." });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title={`Resources for ${computer.ownerName ?? computer.name}`} centered>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <NumberInput label="Memory (GB)" min={1} max={64} step={0.5} decimalScale={1} value={memory} onChange={setMemory} />
          <NumberInput label="CPU cores" min={1} max={32} value={cores} onChange={setCores} allowDecimal={false} />
          <NumberInput label="Disk (GB)" description={`Disks can grow but not shrink (now ${computer.diskGb} GB).`} min={computer.diskGb} max={1024} value={disk} onChange={setDisk} allowDecimal={false} />
          {error ? <Alert color="red" variant="light">{error}</Alert> : null}
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function SerialLog({ computer, onClose }: { computer: AdminComputer; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => api.admin.serialLog(computer.ownerId), [computer.ownerId], 5_000);
  return (
    <Modal opened onClose={onClose} title={`Boot log · ${computer.ownerName ?? computer.name}`} centered size="xl">
      {loading && !data ? <Group justify="center" py="lg"><Loader aria-label="Loading log" /></Group> : null}
      {error ? <Alert color="red" variant="light">{error}</Alert> : null}
      {data ? <pre className="admin-log" style={{ maxHeight: "60vh" }}>{data.log.trim() || "The serial console is empty. It fills when the computer boots."}</pre> : null}
    </Modal>
  );
}

function ResetComputer({ computer, onClose, onDone }: { computer: AdminComputer; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reset() {
    setPending(true);
    setError(null);
    try {
      await api.admin.computerAction(computer.ownerId, "reset");
      notifications.show({ message: "The computer was deleted. A fresh one is created from the newest image when it's next used." });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Reset computer" centered>
      <Stack gap="sm">
        <Text size="sm">
          This powers off {computer.ownerName ? <b>{computer.ownerName}</b> : "this user"}'s computer and deletes its disk ({formatBytes(computer.diskUsedBytes)} used):
          installed programs, downloads and browser data. Chats and bots stay. It can't be undone.
        </Text>
        {error ? <Alert color="red" variant="light">{error}</Alert> : null}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="red" loading={pending} onClick={() => void reset()}>Reset computer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
