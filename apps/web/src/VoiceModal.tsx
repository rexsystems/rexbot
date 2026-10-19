import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Button, Group, Paper, Text, Tooltip } from "@mantine/core";
import type { ClientSettings, Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { startLiveVoice, type LiveConnection } from "./liveVoice";
import { IconMic, IconStop, IconX } from "./icons";

export function VoiceModal({
  bot,
  settings,
  onClose,
  onTranscript,
}: {
  bot: Conversation;
  settings: ClientSettings;
  onClose: () => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
}) {
  const [state, setState] = useState("Starting");
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = useRef<LiveConnection | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  async function stop() {
    abort.current?.abort();
    await call.current?.stop();
    call.current = undefined;
    setRunning(false);
    setMuted(false);
  }

  async function start() {
    setError(null);
    setRunning(true);
    setMuted(false);
    setState("Starting");
    const controller = new AbortController();
    abort.current = controller;
    try {
      call.current = await startLiveVoice(bot.id, settings, controller.signal, {
        state(next) {
          setState(next);
          if (next === "Ended") setRunning(false);
        },
        transcript(role, text) {
          onTranscriptRef.current?.(role, text);
        },
        error: setError,
      });
      setState("Listening");
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      setState("Ready");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    let active = true;

    async function run() {
      if (!settings.googleApiKey?.trim()) {
        if (active) setState("Ready");
        return;
      }
      setError(null);
      setRunning(true);
      setMuted(false);
      setState("Starting");
      try {
        call.current = await startLiveVoice(bot.id, settings, controller.signal, {
          state(next) {
            if (!active) return;
            setState(next);
            if (next === "Ended") setRunning(false);
          },
          transcript(role, text) {
            if (active) onTranscriptRef.current?.(role, text);
          },
          error(message) {
            if (active) setError(message);
          },
        });
        if (active) setState("Listening");
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setRunning(false);
        setState("Ready");
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
      void call.current?.stop();
      call.current = undefined;
    };
  }, [bot.id, settings.googleApiKey, settings.liveModel]);

  const name = bot.bot?.name ?? bot.title;

  return (
    <Paper className="voice-bar" role="region" aria-label="Live voice" p="sm" radius="md" withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <BlobAvatar seed={bot.id} appearance={bot.bot} size={44} pulse={running} />
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>Talking with {name}</Text>
            <Text size="xs" c="dimmed" role="status">{state}</Text>
            <Text size="xs" c="dimmed">{bot.bot?.voice ?? "Kore"} · {settings.liveModel || "gemini-3.8-live"}</Text>
          </div>
        </Group>
        <Group gap={6} wrap="nowrap">
          {running ? (
            <>
              <Button
                size="compact-md"
                variant="default"
                disabled={!call.current}
                onClick={() => {
                  const value = !muted;
                  call.current?.mute(value);
                  setMuted(value);
                }}
              >
                {muted ? "Unmute microphone" : "Mute microphone"}
              </Button>
              <Button size="compact-md" color="red.8" leftSection={<IconStop size={18} />} onClick={() => void stop()}>
                End call
              </Button>
            </>
          ) : (
            <Button size="compact-md" leftSection={<IconMic size={18} />} disabled={!settings.googleApiKey?.trim()} onClick={() => void start()}>
              Start call
            </Button>
          )}
          <Tooltip label="Close voice">
            <ActionIcon
              size={44}
              variant="subtle"
              aria-label="Close voice call"
              onClick={() => void stop().then(onClose)}
            >
              <IconX size={22} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {!settings.googleApiKey?.trim() ? (
        <Alert color="yellow" mt="sm">Add your Google AI Studio API key in Settings to start voice.</Alert>
      ) : null}
      {error ? <Alert role="alert" title="Voice call" color="red" mt="sm">{error}</Alert> : null}
      <Text size="xs" c="dimmed" mt="xs">
        Transcripts appear in this chat. Raw audio is not stored by Rexbot. Change the voice in Customize bot.
      </Text>
    </Paper>
  );
}
