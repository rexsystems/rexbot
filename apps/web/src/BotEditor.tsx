import { useState, type FormEvent } from "react";
import { Alert, Button, ColorInput, Group, Modal, SegmentedControl, Stack, Switch, Text, Textarea, TextInput, UnstyledButton } from "@mantine/core";
import { DEFAULT_BOT, suggestBotName, type BotProfile, type Conversation } from "@rex/shared";
import { BlobAvatar } from "./BlobAvatar";
import { saveBot } from "./api";

const SHAPE_OPTIONS: Array<{ value: BotProfile["shape"]; label: string }> = [
  { value: "orb", label: "Orb" }, { value: "pebble", label: "Pebble" }, { value: "cube", label: "Cube" }, { value: "capsule", label: "Capsule" }, { value: "diamond", label: "Diamond" },
];

export function BotEditor({ initial, existingNames, onClose, onSave }: { initial?: Conversation; existingNames: string[]; onClose: () => void; onSave: (bot: Conversation) => void }) {
  const [profile, setProfile] = useState<BotProfile>(() => initial?.bot ?? { ...DEFAULT_BOT, name: initial ? initial.title.slice(0, 32) : suggestBotName(existingNames) });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validColor = /^#[a-f\d]{6}$/i.test(profile.color);
  const preview = { ...profile, color: validColor ? profile.color : DEFAULT_BOT.color };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try { onSave(await saveBot(profile, initial?.id)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }

  return <Modal opened onClose={onClose} title={initial ? "Customize bot" : "New bot"} closeButtonProps={{ "aria-label": "Close bot editor" }} size="xl" centered>
    <form onSubmit={(event) => void submit(event)}>
      <div className="bot-editor-layout">
        <div className="bot-preview"><BlobAvatar seed="bot-preview" size={176} appearance={preview} /><Text size="xl" fw={600}>{profile.name.trim() || "Your next teammate"}</Text><Text size="sm" c="dimmed">Give your bot a look and a way of working.</Text></div>
      <Stack gap="md">
        <TextInput label="Bot name" placeholder="Name your bot" value={profile.name} maxLength={32} required onChange={(event) => setProfile({ ...profile, name: event.currentTarget.value })} />
        <ColorInput label="Bot color" format="hex" withEyeDropper={false} value={profile.color} onChange={(color) => setProfile({ ...profile, color })} swatches={["#66b8ff", "#f3aa57", "#83cba2", "#b8a3ee", "#eb8ba0", "#e4e0d8"]} error={!validColor ? "Use a six-digit hex color." : undefined} />
        <div><Text size="sm" fw={500} mb="xs" id="bot-shape-label">Shape</Text><div className="bot-shape-picker" role="group" aria-labelledby="bot-shape-label">{SHAPE_OPTIONS.map((shape) => <UnstyledButton key={shape.value} className="bot-shape-option" aria-label={`${shape.label} shape`} aria-pressed={profile.shape === shape.value} onClick={() => setProfile({ ...profile, shape: shape.value })}><BlobAvatar seed={`shape-${shape.value}`} size={52} appearance={{ ...preview, shape: shape.value, motion: "still", blink: false }} /><Text size="xs">{shape.label}</Text></UnstyledButton>)}</div></div>
        <Stack gap={8}><Text size="sm" fw={500} id="bot-motion-label">Movement</Text><SegmentedControl aria-labelledby="bot-motion-label" fullWidth value={profile.motion} onChange={(motion) => setProfile({ ...profile, motion: motion as BotProfile["motion"] })} data={[{ label: "Float", value: "float" }, { label: "Orbit", value: "orbit" }, { label: "Spin", value: "spin" }, { label: "Still", value: "still" }]} /></Stack>
        <Switch label="Blinking eyes" description="Motion pauses when reduced motion is enabled on your device." checked={profile.blink} onChange={(event) => setProfile({ ...profile, blink: event.currentTarget.checked })} />
        <Textarea label="How should this bot work?" description="Optional instructions for its tone and approach." placeholder="For example: answer in Romanian and keep explanations short." value={profile.instructions} maxLength={1000} minRows={2} maxRows={6} autosize onChange={(event) => setProfile({ ...profile, instructions: event.currentTarget.value })} />
        {error ? <Alert color="red" title="Could not save bot" role="alert">{error}</Alert> : null}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button type="submit" loading={pending} disabled={!profile.name.trim() || !validColor}>{initial ? "Save bot" : "Create bot"}</Button></Group>
      </Stack>
      </div>
    </form>
  </Modal>;
}
