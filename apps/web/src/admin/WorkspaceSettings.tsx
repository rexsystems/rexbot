import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Group, Loader, NumberInput, Paper, Radio, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AppSettings } from "@rex/shared";
import * as api from "../api";
import { errorText } from "./format";
import { useLoad } from "./useLoad";

export function WorkspaceSettings() {
  const { data, error, loading, setData } = useLoad(() => api.admin.settings(), []);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (loading && !draft) return <Group justify="center" py="xl"><Loader aria-label="Loading settings" /></Group>;
  if (!draft) return <Alert color="red" variant="light" title="Could not load settings">{error}</Alert>;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft({ ...draft, [key]: value });
  const num = (key: "vmMemoryMb" | "vmCores" | "vmDiskGb" | "vmIdleMinutes" | "vmMaxRunning" | "maxBotsPerUser", scale = 1) => (value: number | string) => {
    if (typeof value === "number") set(key, Math.round(value * scale));
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(data);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    try {
      const saved = await api.admin.updateSettings(draft);
      setData(saved);
      notifications.show({ message: "Settings saved." });
    } catch (err) {
      notifications.show({ color: "red", title: "Settings weren't saved", message: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <Stack gap="lg">
        <Paper className="admin-card" withBorder radius="md" p="lg">
          <Stack gap="md">
            <Title order={3} size="h5">Workspace</Title>
            <TextInput label="Name" description="Shown on the sign-in page and in page titles." value={draft.workspaceName} onChange={(event) => set("workspaceName", event.currentTarget.value)} maxLength={48} required />
            <Radio.Group label="Sign-up" description="Admins can always add accounts under Users." value={draft.signupMode} onChange={(value) => set("signupMode", value as AppSettings["signupMode"])}>
              <Stack gap="xs" mt="xs">
                <Radio value="closed" label="Closed" description="Only admins create accounts." />
                <Radio value="open" label="Open" description="Anyone who can reach this server can create an account." />
              </Stack>
            </Radio.Group>
            <NumberInput label="Bots per user" min={1} max={500} allowDecimal={false} value={draft.maxBotsPerUser} onChange={num("maxBotsPerUser")} maw={240} />
          </Stack>
        </Paper>
        <Paper className="admin-card" withBorder radius="md" p="lg">
          <Stack gap="md">
            <div>
              <Title order={3} size="h5">Computers</Title>
              <Text size="sm" c="dimmed">Defaults for new computers. Change an existing one under Computers.</Text>
            </div>
            <Group grow align="flex-start" wrap="wrap" style={{ rowGap: 12 }}>
              <NumberInput label="Memory (GB)" min={1} max={64} step={0.5} decimalScale={1} value={draft.vmMemoryMb / 1024} onChange={num("vmMemoryMb", 1024)} miw={160} />
              <NumberInput label="CPU cores" min={1} max={32} allowDecimal={false} value={draft.vmCores} onChange={num("vmCores")} miw={160} />
              <NumberInput label="Disk (GB)" min={8} max={1024} allowDecimal={false} value={draft.vmDiskGb} onChange={num("vmDiskGb")} miw={160} />
            </Group>
            <Group grow align="flex-start" wrap="wrap" style={{ rowGap: 12 }}>
              <NumberInput label="Running at once" description="Further starts wait until one shuts down." min={1} max={256} allowDecimal={false} value={draft.vmMaxRunning} onChange={num("vmMaxRunning")} miw={200} />
              <NumberInput label="Shut down when idle (minutes)" description="0 keeps computers on." min={0} max={1440} allowDecimal={false} value={draft.vmIdleMinutes} onChange={num("vmIdleMinutes")} miw={200} />
            </Group>
          </Stack>
        </Paper>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" disabled={!changed || pending} onClick={() => data && setDraft(data)}>Discard changes</Button>
          <Button type="submit" loading={pending} disabled={!changed || !draft.workspaceName.trim()}>Save settings</Button>
        </Group>
      </Stack>
    </form>
  );
}
