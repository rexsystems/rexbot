import { Alert, Badge, Button, Group, Loader, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import * as api from "../api";
import type { AdminSection } from "./AdminPanel";
import { formatNumber } from "./format";
import { useLoad } from "./useLoad";

function Stat({ label, value, detail, action }: { label: string; value: string; detail?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <Paper className="admin-card" withBorder radius="md" p="lg">
      <Stack gap={6}>
        <Text size="sm" c="dimmed" fw={500}>{label}</Text>
        <div className="admin-stat-value">{value}</div>
        {detail ? <Text size="sm" c="dimmed">{detail}</Text> : null}
        {action ? <Group mt={4}><Button size="xs" variant="subtle" px={0} onClick={action.onClick}>{action.label}</Button></Group> : null}
      </Stack>
    </Paper>
  );
}

export function Overview({ onOpen }: { onOpen: (section: AdminSection) => void }) {
  const { data, error, loading, reload } = useLoad(() => api.admin.overview(), [], 15_000);
  if (loading && !data) return <Group justify="center" py="xl"><Loader aria-label="Loading overview" /></Group>;
  if (!data) return <Alert color="red" variant="light" title="Could not load the overview">{error}<Group mt="sm"><Button size="xs" variant="light" onClick={() => void reload()}>Try again</Button></Group></Alert>;
  const vm = data.computers;
  const computerDetail = vm.kind === "podman"
    ? "Podman sandboxes (no screen)"
    : vm.buildRunning ? "The computer image is being built" : vm.templateVersion ? `Image v${vm.templateVersion}` : "No computer image yet";
  return (
    <Stack gap="lg">
      {vm.kind === "qemu" && !vm.templateVersion && !vm.buildRunning ? (
        <Alert color="orange" variant="light" title="Computers need an image">
          Bots can chat, but nobody gets a computer until the image is built. It takes a few minutes with KVM.
          <Group mt="sm"><Button size="xs" variant="light" onClick={() => onOpen("computers")}>Open Computers</Button></Group>
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
        <Stat label="Users" value={formatNumber(data.users)} detail={`${formatNumber(data.activeUsers7d)} active in the last 7 days${data.disabledUsers ? `, ${formatNumber(data.disabledUsers)} disabled` : ""}`} action={{ label: "Manage users", onClick: () => onOpen("users") }} />
        <Stat label="Bots" value={formatNumber(data.bots)} detail={`${formatNumber(data.groups)} ${data.groups === 1 ? "group" : "groups"}`} />
        <Stat label="Messages" value={formatNumber(data.messages)} detail={`${formatNumber(data.messages24h)} in the last 24 hours`} action={{ label: "See usage", onClick: () => onOpen("usage") }} />
        <Stat label="Computers running" value={`${formatNumber(vm.running)} / ${formatNumber(vm.total)}`} detail={computerDetail} action={{ label: "Manage computers", onClick: () => onOpen("computers") }} />
        <Paper className="admin-card" withBorder radius="md" p="lg">
          <Stack gap={6}>
            <Text size="sm" c="dimmed" fw={500}>Sign-up</Text>
            <Group gap="xs"><Badge size="lg" variant="light" color={data.signupMode === "open" ? "green" : "gray"}>{data.signupMode === "open" ? "Open" : "Closed"}</Badge></Group>
            <Text size="sm" c="dimmed">{data.signupMode === "open" ? "Anyone who can reach this server can create an account." : "Only admins can add accounts."}</Text>
            <Group mt={4}><Button size="xs" variant="subtle" px={0} onClick={() => onOpen("settings")}>Change</Button></Group>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
