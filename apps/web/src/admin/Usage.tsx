import { useState } from "react";
import { Alert, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import * as api from "../api";
import { formatNumber } from "./format";
import { useLoad } from "./useLoad";

const RANGES = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function Usage() {
  const [days, setDays] = useState("30");
  const { data, error, loading } = useLoad(() => api.admin.usage(Number(days)), [days]);
  const totals = data ? data.daily.reduce((sum, day) => ({ messages: sum.messages + day.messages, tokens: sum.tokens + day.promptTokens + day.completionTokens }), { messages: 0, tokens: 0 }) : null;
  const peak = data ? Math.max(1, ...data.daily.map((day) => day.messages)) : 1;

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Text c="dimmed" size="sm">Counted from this server's database. Times are in UTC days.</Text>
        <SegmentedControl aria-label="Time range" value={days} onChange={setDays} data={RANGES} />
      </Group>
      {error ? <Alert color="red" variant="light">{error}</Alert> : null}
      {loading && !data ? <Group justify="center" py="xl"><Loader aria-label="Loading usage" /></Group> : null}
      {data && totals ? (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
            <Paper className="admin-card" withBorder radius="md" p="lg">
              <Text size="sm" c="dimmed" fw={500}>Messages</Text>
              <div className="admin-stat-value">{formatNumber(totals.messages)}</div>
              <Text size="sm" c="dimmed">Yours and the bots', last {data.days} days</Text>
            </Paper>
            <Paper className="admin-card" withBorder radius="md" p="lg">
              <Text size="sm" c="dimmed" fw={500}>Tokens</Text>
              <div className="admin-stat-value">{formatNumber(totals.tokens)}</div>
              <Text size="sm" c="dimmed">{totals.tokens ? "As reported by the model providers" : "Not reported by the providers in this period"}</Text>
            </Paper>
          </SimpleGrid>
          <Paper className="admin-card" withBorder radius="md" p="lg">
            <Title order={3} size="h5" mb="xs">Messages per day</Title>
            {totals.messages === 0 ? <Text c="dimmed" size="sm">No messages in this period.</Text> : (
              <>
                <div className="usage-chart" role="img" aria-label={`Messages per day over ${data.days} days, peak ${peak}`}>
                  {data.daily.map((day) => (
                    <Tooltip key={day.day} label={`${day.day}: ${formatNumber(day.messages)} messages`} withArrow>
                      <div className={`usage-bar${day.messages ? "" : " empty"}`} style={{ height: `${Math.max(2, (day.messages / peak) * 100)}%` }} />
                    </Tooltip>
                  ))}
                </div>
                <Group justify="space-between" mt={6}><Text size="xs" c="dimmed">{data.daily[0]?.day}</Text><Text size="xs" c="dimmed">{data.daily.at(-1)?.day}</Text></Group>
              </>
            )}
          </Paper>
          <Stack gap="xs">
            <Title order={3} size="h5">By user</Title>
            <Table.ScrollContainer minWidth={560}>
              <Table className="admin-table" verticalSpacing="xs">
                <Table.Thead><Table.Tr><Table.Th>User</Table.Th><Table.Th ta="right">Messages</Table.Th><Table.Th ta="right">Prompt tokens</Table.Th><Table.Th ta="right">Completion tokens</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data.byUser.map((row) => (
                    <Table.Tr key={row.userId}>
                      <Table.Td><Text size="sm" fw={500}>{row.name}</Text><Text size="xs" c="dimmed">{row.email}</Text></Table.Td>
                      <Table.Td ta="right">{formatNumber(row.messages)}</Table.Td>
                      <Table.Td ta="right">{formatNumber(row.promptTokens)}</Table.Td>
                      <Table.Td ta="right">{formatNumber(row.completionTokens)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
          <Stack gap="xs">
            <Title order={3} size="h5">By model</Title>
            {data.byModel.length === 0 ? <Text size="sm" c="dimmed">No model requests recorded in this period.</Text> : (
              <Table.ScrollContainer minWidth={560}>
                <Table className="admin-table" verticalSpacing="xs">
                  <Table.Thead><Table.Tr><Table.Th>Provider</Table.Th><Table.Th>Model</Table.Th><Table.Th ta="right">Requests</Table.Th><Table.Th ta="right">Prompt tokens</Table.Th><Table.Th ta="right">Completion tokens</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {data.byModel.map((row) => (
                      <Table.Tr key={`${row.provider}/${row.model}`}>
                        <Table.Td>{row.provider}</Table.Td>
                        <Table.Td><Text size="sm" ff="monospace">{row.model}</Text></Table.Td>
                        <Table.Td ta="right">{formatNumber(row.requests)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.promptTokens)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.completionTokens)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
