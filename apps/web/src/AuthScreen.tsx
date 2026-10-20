import { useEffect, useState, type FormEvent } from "react";
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import type { AuthState, AuthUser } from "@rex/shared";
import * as api from "./api";
import { BlobAvatar } from "./BlobAvatar";

export type AuthMode = "signin" | "signup";

/** Sign-in and sign-up in one card. The first account on a new server becomes the admin. */
export function AuthScreen({ state, mode, onModeChange, onSignedIn }: {
  state: AuthState;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSignedIn: (user: AuthUser) => void;
}) {
  const signup = state.needsSetup || (mode === "signup" && state.signupOpen);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = state.needsSetup ? "Set up Rex" : signup ? `Create account · ${state.workspaceName}` : `Sign in · ${state.workspaceName}`;
  }, [signup, state.needsSetup, state.workspaceName]);

  useEffect(() => setError(null), [signup]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = signup ? await api.signUp(name.trim(), email.trim(), password) : await api.signIn(email.trim(), password);
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <Paper className="auth-card" withBorder radius="md" p="xl">
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Stack gap="md">
            <Stack gap={6} align="center" ta="center" mb="xs">
              <BlobAvatar seed="rex-brand" size={72} float />
              <Title order={2}>{state.needsSetup ? "Set up Rex" : signup ? "Create your account" : `Sign in to ${state.workspaceName}`}</Title>
              <Text c="dimmed" size="sm" maw={340}>
                {state.needsSetup
                  ? "This server has no accounts yet. The account you create now is the admin, and it keeps the bots and chats already on this server."
                  : signup ? "Your bots, chats, memory and computer are private to your account." : "Welcome back. Your bots are where you left them."}
              </Text>
            </Stack>
            {signup ? <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="name" required maxLength={64} /> : null}
            <TextInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" required />
            <PasswordInput
              label="Password"
              description={signup ? "At least 8 characters." : undefined}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete={signup ? "new-password" : "current-password"}
              required
              visibilityToggleButtonProps={{ "aria-label": "Toggle password visibility" }}
            />
            {error ? <Alert color="red" variant="light" role="alert">{error}</Alert> : null}
            <Button type="submit" size="md" loading={pending} disabled={!email.trim() || !password || (signup && (!name.trim() || password.length < 8))}>
              {state.needsSetup ? "Create admin account" : signup ? "Create account" : "Sign in"}
            </Button>
            {state.needsSetup ? null : signup ? (
              <Text size="sm" c="dimmed" ta="center">Already have an account? <Anchor component="button" type="button" onClick={() => onModeChange("signin")}>Sign in</Anchor></Text>
            ) : state.signupOpen ? (
              <Text size="sm" c="dimmed" ta="center">New here? <Anchor component="button" type="button" onClick={() => onModeChange("signup")}>Create an account</Anchor></Text>
            ) : (
              <Text size="sm" c="dimmed" ta="center">Sign-up is closed on this server. Ask an admin to create your account.</Text>
            )}
          </Stack>
        </form>
      </Paper>
    </main>
  );
}
