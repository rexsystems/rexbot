import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import type { ClientSettings, Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { startLiveVoice, type LiveConnection } from "./liveVoice";
import { IconMic, IconStop } from "./icons";

export function VoiceModal({ bot, settings, onClose }: { bot: Conversation; settings: ClientSettings; onClose: () => void }) {
  const [state, setState] = useState("Ready");
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const call = useRef<LiveConnection | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); void call.current?.stop(); }, []);
  async function stop() { abort.current?.abort(); await call.current?.stop(); call.current = undefined; setRunning(false); setMuted(false); }
  async function start() {
    setError(null); setRunning(true); setTranscript([]); setMuted(false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      call.current = await startLiveVoice(bot.id, settings, controller.signal, {
        state(next) { setState(next); if (next === "Ended") setRunning(false); },
        transcript(role, text) { setTranscript((prev) => prev.at(-1)?.role === role ? [...prev.slice(0, -1), { role, text: prev.at(-1)!.text + text }] : [...prev, { role, text }]); },
        error: setError,
      });
      setState("Listening");
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)); setRunning(false); }
  }
  return <Modal opened onClose={() => void stop().then(onClose)} title={`Live voice · ${bot.bot?.name ?? bot.title}`} closeButtonProps={{ "aria-label": "Close voice call" }} centered size="lg">
    <Stack>
      <Group justify="center"><BlobAvatar seed={bot.id} appearance={bot.bot} size={100} /><Text role="status">{state}</Text></Group>
      <Text size="sm" c="dimmed">{settings.liveModel || "gemini-3.8-live"} · Audio goes to Google while connected. Transcripts are saved in this bot's chat; raw audio is not stored by Rexbot.</Text>
      {!settings.googleApiKey?.trim() ? <Alert color="yellow">Add your Google AI Studio API key in Settings to start voice.</Alert> : null}
      {error ? <Alert role="alert" title="Voice call" color="red">{error}</Alert> : null}
      <ScrollArea.Autosize mah={260}><Stack gap="sm">{transcript.length ? transcript.map((turn, index) => <div key={index}><Text size="xs" c="dimmed">{turn.role === "user" ? "You" : bot.bot?.name}</Text><Text style={{ whiteSpace: "pre-wrap" }}>{turn.text}</Text></div>) : <Text c="dimmed" size="sm">Start a call, then speak naturally. You can interrupt the bot or mute your microphone.</Text>}</Stack></ScrollArea.Autosize>
      <Group justify="center">{running ? <><Button variant="default" disabled={!call.current} onClick={() => { const value = !muted; call.current?.mute(value); setMuted(value); }}>{muted ? "Unmute microphone" : "Mute microphone"}</Button><Button color="red.8" leftSection={<IconStop size={20} />} onClick={() => void stop()}>End call</Button></> : <Button leftSection={<IconMic size={20} />} disabled={!settings.googleApiKey?.trim()} onClick={() => void start()}>Start call</Button>}</Group>
    </Stack>
  </Modal>;
}
