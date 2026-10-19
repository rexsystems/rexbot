import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Button, Group, Paper, Text, Tooltip } from "@mantine/core";
import type { ClientSettings, Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { startLiveVoice, type LiveConnection } from "./liveVoice";
import { IconMic, IconStop, IconX } from "./icons";
import { playCallEnd, playCallStart } from "./uiSounds";

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
  const onCloseRef = useRef(onClose);
  const heardConnect = useRef(false);
  onTranscriptRef.current = onTranscript;
  onCloseRef.current = onClose;

  function wireCallbacks(active: () => boolean) {
    return {
      state(next: string) {
        if (!active()) return;
        setState(next);
        if (next === "Listening" && !heardConnect.current) {
          heardConnect.current = true;
          playCallStart();
        }
        if (next === "Ended") setRunning(false);
      },
      transcript(role: "user" | "assistant", text: string) {
        if (active()) onTranscriptRef.current?.(role, text);
      },
      error(message: string) {
        if (active()) setError(message);
      },
      ended(reason: "user" | "bot" | "error") {
        if (!active()) return;
        setRunning(false);
        setState("Ended");
        if (reason === "bot") {
          playCallEnd();
          onCloseRef.current();
        }
      },
    };
  }

  async function stop(playEndSound = true) {
    abort.current?.abort();
    if (playEndSound && call.current) playCallEnd();
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
    heardConnect.current = false;
    const controller = new AbortController();
    abort.current = controller;
    const active = () => !controller.signal.aborted;
    try {
      call.current = await startLiveVoice(bot.id, settings, controller.signal, wireCallbacks(active));
      if (active()) setState("Listening");
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
    const isActive = () => active && !controller.signal.aborted;
    heardConnect.current = false;

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
        call.current = await startLiveVoice(bot.id, settings, controller.signal, wireCallbacks(isActive));
        if (isActive()) setState("Listening");
      } catch (err) {
        if (!isActive()) return;
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
              <Button size="compact-md" color="red.8" leftSection={<IconStop size={18} />} onClick={() => void stop(true)}>
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
              onClick={() => void stop(running).then(onClose)}
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
        Transcripts appear in this chat. Say hang up or goodbye to end the call, or use End call. Change the voice in Customize bot.
      </Text>
    </Paper>
  );
}
