import { useState } from "react";
import { Alert, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import * as api from "../api";
import { formatNumber } from "./format";
import { useLoad } from "./useLoad";

const RANGES = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

const exactTokens = new Intl.NumberFormat("en-US");
const compactTokens = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function TokenCount({ value }: { value: number | null | undefined }) {
  if (value == null) return <span>Not reported</span>;
  const exact = exactTokens.format(value);
  if (value < 1_000_000) return <span>{exact}</span>;
  return (
    <Tooltip label={exact} withArrow events={{ hover: true, focus: true, touch: true }}>
      <span tabIndex={0} aria-label={`${exact} tokens`}>{compactTokens.format(value)}</span>
    </Tooltip>
  );
}

export function Usage() {
  const [days, setDays] = useState("30");
  const { data, error, loading } = useLoad(() => api.admin.usage(Number(days)), [days]);
  const totals = data ? data.daily.reduce((sum, day) => ({ messages: sum.messages + day.messages, tokens: sum.tokens + day.promptTokens + day.completionTokens }), { messages: 0, tokens: 0 }) : null;
  const metrics = data ? data.daily.reduce((sum, day) => ({
    requests: sum.requests + (day.requests ?? 0), toolCalls: sum.toolCalls + (day.toolCalls ?? 0),
    reported: sum.reported + (day.cacheReportedRequests ?? 0),
    cacheRead: day.cacheReadTokens == null ? sum.cacheRead : (sum.cacheRead ?? 0) + day.cacheReadTokens,
    cacheWrite: day.cacheWriteTokens == null ? sum.cacheWrite : (sum.cacheWrite ?? 0) + day.cacheWriteTokens,
    reasoning: day.reasoningTokens == null ? sum.reasoning : (sum.reasoning ?? 0) + day.reasoningTokens,
  }), { requests: 0, toolCalls: 0, reported: 0, cacheRead: null as number | null, cacheWrite: null as number | null, reasoning: null as number | null }) : null;
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
              <div className="admin-stat-value"><TokenCount value={totals.tokens} /></div>
              <Text size="sm" c="dimmed">{totals.tokens ? "As reported by the model providers" : "Not reported by the providers in this period"}</Text>
            </Paper>
          </SimpleGrid>
          {metrics ? <Paper className="admin-card" withBorder radius="md" p="lg">
            <Group gap="xl" wrap="wrap">
              {([['Requests', metrics.requests], ['Tool calls', metrics.toolCalls], ['Cache read', metrics.cacheRead], ['Cache write', metrics.cacheWrite], ['Reasoning tokens', metrics.reasoning]] as const).map(([label, value]) => (
                <div key={label}><Text size="sm" c="dimmed">{label}</Text><Text fw={600}><TokenCount value={value} /></Text></div>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt="sm">Cache read reported on {formatNumber(metrics.reported)} of {formatNumber(metrics.requests)} requests. Cache tokens are included in input; reasoning tokens are included in output. Unreported details and older requests are left unknown.</Text>
          </Paper> : null}
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
            <Table.ScrollContainer minWidth={1050}>
              <Table className="admin-table" verticalSpacing="xs">
                <Table.Thead><Table.Tr><Table.Th>User</Table.Th><Table.Th ta="right">Messages</Table.Th><Table.Th ta="right">Prompt tokens</Table.Th><Table.Th ta="right">Completion tokens</Table.Th><Table.Th ta="right">Cache read</Table.Th><Table.Th ta="right">Cache write</Table.Th><Table.Th ta="right">Reasoning</Table.Th><Table.Th ta="right">Tool calls</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data.byUser.map((row) => (
                    <Table.Tr key={row.userId}>
                      <Table.Td><Text size="sm" fw={500}>{row.name}</Text><Text size="xs" c="dimmed">{row.email}</Text></Table.Td>
                      <Table.Td ta="right">{formatNumber(row.messages)}</Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.promptTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.completionTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.cacheReadTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.cacheWriteTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.reasoningTokens} /></Table.Td>
                      <Table.Td ta="right">{formatNumber(row.toolCalls ?? 0)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
          <Stack gap="xs">
            <Title order={3} size="h5">By model</Title>
            {data.byModel.length === 0 ? <Text size="sm" c="dimmed">No model requests recorded in this period.</Text> : (
              <Table.ScrollContainer minWidth={1050}>
                <Table className="admin-table" verticalSpacing="xs">
                  <Table.Thead><Table.Tr><Table.Th>Provider</Table.Th><Table.Th>Model</Table.Th><Table.Th ta="right">Requests</Table.Th><Table.Th ta="right">Prompt tokens</Table.Th><Table.Th ta="right">Completion tokens</Table.Th><Table.Th ta="right">Cache read</Table.Th><Table.Th ta="right">Cache write</Table.Th><Table.Th ta="right">Reasoning</Table.Th><Table.Th ta="right">Tool calls</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {data.byModel.map((row) => (
                      <Table.Tr key={`${row.provider}/${row.model}`}>
                        <Table.Td>{row.provider}</Table.Td>
                        <Table.Td><Text size="sm" ff="monospace">{row.model}</Text></Table.Td>
                        <Table.Td ta="right">{formatNumber(row.requests)}</Table.Td>
                        <Table.Td ta="right"><TokenCount value={row.promptTokens} /></Table.Td>
                        <Table.Td ta="right"><TokenCount value={row.completionTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.cacheReadTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.cacheWriteTokens} /></Table.Td>
                      <Table.Td ta="right"><TokenCount value={row.reasoningTokens} /></Table.Td>
                      <Table.Td ta="right">{formatNumber(row.toolCalls ?? 0)}</Table.Td>
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
