import { useState, type FormEvent } from "react";
import { ActionIcon, Alert, Avatar, Badge, Button, Group, Loader, Menu, Modal, PasswordInput, SegmentedControl, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AdminUser } from "@rex/shared";
import * as api from "../api";
import { IconBotAdd, IconSearch } from "../icons";
import { useSession } from "../session";
import { errorText, formatNumber, formatWhen, STATE_COLORS } from "./format";
import { useLoad } from "./useLoad";

type Dialog = { kind: "create" } | { kind: "password"; user: AdminUser } | { kind: "delete"; user: AdminUser } | null;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}

export function Users() {
  const session = useSession();
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useLoad(() => api.admin.users(query.trim()), [query]);
  const [dialog, setDialog] = useState<Dialog>(null);

  async function act(label: string, action: () => Promise<unknown>) {
    try {
      await action();
      notifications.show({ message: label });
      await reload();
    } catch (err) {
      notifications.show({ color: "red", title: "That didn't work", message: errorText(err) });
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <TextInput
          aria-label="Search users"
          placeholder="Search by name or email"
          leftSection={<IconSearch size={18} />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          style={{ flex: "1 1 260px", maxWidth: 420 }}
        />
        <Button leftSection={<IconBotAdd size={20} />} onClick={() => setDialog({ kind: "create" })}>Add user</Button>
      </Group>
      {error ? <Alert color="red" variant="light">{error}</Alert> : null}
      {loading && !data ? <Group justify="center" py="xl"><Loader aria-label="Loading users" /></Group> : null}
      {data && data.length === 0 ? <Text c="dimmed" ta="center" py="xl">{query ? `No one matches "${query}".` : "No users yet."}</Text> : null}
      {data && data.length > 0 ? (
        <Table.ScrollContainer minWidth={820}>
          <Table className="admin-table" verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Bots</Table.Th>
                <Table.Th ta="right">Messages</Table.Th>
                <Table.Th>Computer</Table.Th>
                <Table.Th>Last seen</Table.Th>
                <Table.Th><span className="visually-hidden">Actions</span></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((user) => {
                const self = user.id === session.user.id;
                return (
                  <Table.Tr key={user.id}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <Avatar radius="xl" size={34} color="orange">{initials(user.name)}</Avatar>
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>{user.name}{self ? <Text span c="dimmed" size="xs"> (you)</Text> : null}</Text>
                          <Text size="xs" c="dimmed" truncate>{user.email}</Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td><Badge variant="light" color={user.role === "admin" ? "ember" : "gray"}>{user.role === "admin" ? "Admin" : "User"}</Badge></Table.Td>
                    <Table.Td><Badge variant="dot" color={user.status === "active" ? "green" : "red"}>{user.status === "active" ? "Active" : "Disabled"}</Badge></Table.Td>
                    <Table.Td ta="right">{formatNumber(user.bots)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(user.messages)}</Table.Td>
                    <Table.Td>{user.computerState ? <Badge variant="light" color={STATE_COLORS[user.computerState] ?? "gray"}>{user.computerState}</Badge> : <Text size="sm" c="dimmed">None yet</Text>}</Table.Td>
                    <Table.Td><Text size="sm" title={user.lastSeenAt ?? undefined}>{formatWhen(user.lastSeenAt)}</Text></Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target><ActionIcon variant="subtle" size={36} aria-label={`Actions for ${user.name}`}><Text fw={700} aria-hidden>⋯</Text></ActionIcon></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item disabled={self} onClick={() => void act(user.role === "admin" ? `${user.name} is now a user.` : `${user.name} is now an admin.`, () => api.admin.updateUser(user.id, { role: user.role === "admin" ? "user" : "admin" }))}>
                            {user.role === "admin" ? "Remove admin access" : "Make admin"}
                          </Menu.Item>
                          <Menu.Item disabled={self} onClick={() => void act(user.status === "active" ? `${user.name} is disabled and signed out.` : `${user.name} can sign in again.`, () => api.admin.updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" }))}>
                            {user.status === "active" ? "Disable account" : "Enable account"}
                          </Menu.Item>
                          <Menu.Item onClick={() => setDialog({ kind: "password", user })}>Set a new password</Menu.Item>
                          <Menu.Item disabled={!user.sessions} onClick={() => void act(`${user.name} was signed out everywhere.`, () => api.admin.signOutUser(user.id))}>
                            Sign out everywhere{user.sessions ? ` (${user.sessions})` : ""}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item color="red" disabled={self} onClick={() => setDialog({ kind: "delete", user })}>Delete account…</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}
      {dialog?.kind === "create" ? <CreateUser onClose={() => setDialog(null)} onCreated={() => { setDialog(null); void reload(); }} /> : null}
      {dialog?.kind === "password" ? <SetPassword user={dialog.user} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "delete" ? <DeleteUser user={dialog.user} onClose={() => setDialog(null)} onDeleted={() => { setDialog(null); void reload(); }} /> : null}
    </Stack>
  );
}

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.admin.createUser({ name: name.trim(), email: email.trim(), password, role });
      notifications.show({ message: `Account for ${email.trim()} created. Share the password with them privately.` });
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Add user" centered>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} required maxLength={64} data-autofocus />
          <TextInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
          <PasswordInput label="Temporary password" description="At least 8 characters. They can change it under Account." value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" required />
          <Stack gap={4}>
            <Text size="sm" fw={500}>Role</Text>
            <SegmentedControl value={role} onChange={(value) => setRole(value as "user" | "admin")} data={[{ value: "user", label: "User" }, { value: "admin", label: "Admin" }]} />
          </Stack>
          {error ? <Alert color="red" variant="light">{error}</Alert> : null}
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending} disabled={!name.trim() || !email.trim() || password.length < 8}>Create account</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function SetPassword({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.admin.setPassword(user.id, password);
      notifications.show({ message: `New password set for ${user.name}. Their other sessions were signed out.` });
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title={`New password for ${user.name}`} centered>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <PasswordInput label="New password" description="At least 8 characters." value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" required data-autofocus />
          {error ? <Alert color="red" variant="light">{error}</Alert> : null}
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending} disabled={password.length < 8}>Set password</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function DeleteUser({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.admin.deleteUser(user.id);
      notifications.show({ message: `${user.email} and everything it owned were deleted.` });
      onDeleted();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Delete account" centered>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <Text size="sm">
            This permanently deletes <b>{user.name}</b>'s account, {formatNumber(user.bots)} {user.bots === 1 ? "bot" : "bots"}, every chat and group,
            memory, uploaded files, and their computer's disk. It can't be undone.
          </Text>
          <TextInput label={`Type ${user.email} to confirm`} value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} autoComplete="off" data-autofocus />
          {error ? <Alert color="red" variant="light">{error}</Alert> : null}
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
            <Button type="submit" color="red" loading={pending} disabled={confirm.trim().toLowerCase() !== user.email}>Delete account</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
