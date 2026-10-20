import { useState, type FormEvent } from "react";
import { Alert, Button, Divider, Group, Modal, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import * as api from "./api";
import { useSession } from "./session";

export function AccountModal({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [name, setName] = useState(session.user.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState<"profile" | "password" | null>(null);
  const [message, setMessage] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setPending("profile");
    setMessage(null);
    try {
      const { user } = await api.updateProfile(name.trim());
      session.setUser(user);
      setMessage({ tone: "green", text: "Name saved." });
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(null);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPending("password");
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setMessage({ tone: "green", text: "Password changed. Other devices were signed out." });
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <Modal opened onClose={onClose} title="Account" centered size="md">
      <Stack gap="lg">
        <form onSubmit={(event) => void saveProfile(event)}>
          <Stack gap="sm">
            <TextInput label="Email" value={session.user.email} readOnly description={session.user.role === "admin" ? "Admin account" : undefined} />
            <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={64} required />
            <Group justify="flex-end"><Button type="submit" variant="light" loading={pending === "profile"} disabled={!name.trim() || name.trim() === session.user.name}>Save name</Button></Group>
          </Stack>
        </form>
        <Divider />
        <form onSubmit={(event) => void savePassword(event)}>
          <Stack gap="sm">
            <Text fw={600} size="sm">Change password</Text>
            <PasswordInput label="Current password" value={current} onChange={(event) => setCurrent(event.currentTarget.value)} autoComplete="current-password" required />
            <PasswordInput label="New password" description="At least 8 characters." value={next} onChange={(event) => setNext(event.currentTarget.value)} autoComplete="new-password" required />
            <Group justify="flex-end"><Button type="submit" variant="light" loading={pending === "password"} disabled={!current || next.length < 8}>Change password</Button></Group>
          </Stack>
        </form>
        {message ? <Alert color={message.tone} variant="light" role="status">{message.text}</Alert> : null}
      </Stack>
    </Modal>
  );
}
