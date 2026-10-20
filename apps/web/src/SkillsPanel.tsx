import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Group, Loader, Paper, Stack, Text, TextInput, Textarea } from "@mantine/core";
import type { Skill } from "@rex/shared";
import * as api from "./api";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function SkillForm({ skill, onSaved, onCancel }: { skill?: Skill; onSaved: (skill: Skill) => void; onCancel: () => void }) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name, description, instructions };
      onSaved(skill ? await api.skills.update(skill.id, input) : await api.skills.create(input));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <Stack gap="sm">
        <Text fw={600}>{skill ? `Edit ${skill.name}` : "New skill"}</Text>
        <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={60} placeholder="Release notes" required />
        <TextInput label="When to use it" description="Bots read this to decide when to load the skill." value={description} onChange={(event) => setDescription(event.currentTarget.value)} maxLength={300} placeholder="When I ask for release notes from a list of commits" required />
        <Textarea label="Instructions" description="Loaded only when needed, so it can be long: steps, formats, examples, checklists." value={instructions} onChange={(event) => setInstructions(event.currentTarget.value)} autosize minRows={6} maxRows={16} maxLength={12000} required styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 13 } }} />
        {error ? <Alert color="red" variant="light" role="alert">{error}</Alert> : null}
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !description.trim() || !instructions.trim()}>{skill ? "Save" : "Add skill"}</Button>
        </Group>
      </Stack>
    </form>
  );
}

/** The user's skill library. Every bot of this account can load these. */
export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ skill?: Skill } | null>(null);

  useEffect(() => { api.skills.list().then(setSkills).catch((err) => setError(errorText(err))); }, []);

  const replace = (next: Skill) => setSkills((previous) => [...(previous ?? []).filter((item) => item.id !== next.id), next].sort((a, b) => a.name.localeCompare(b.name)));

  async function remove(skill: Skill) {
    if (!window.confirm(`Delete the skill "${skill.name}"?`)) return;
    try { await api.skills.remove(skill.id); setSkills((previous) => (previous ?? []).filter((item) => item.id !== skill.id)); } catch (err) { setError(errorText(err)); }
  }

  if (form) return <SkillForm skill={form.skill} onCancel={() => setForm(null)} onSaved={(skill) => { replace(skill); setForm(null); }} />;

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">Skills are instructions you write once, like how you want release notes or a weekly report done. Your bots see each skill's name and when to use it, and load the full instructions only when a task matches.</Text>
      {error ? <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>{error}</Alert> : null}
      <Group><Button variant="light" onClick={() => setForm({})}>New skill</Button></Group>
      {skills === null && !error ? <Group justify="center" py="md"><Loader size="sm" aria-label="Loading skills" /></Group> : null}
      {skills?.length === 0 ? <Text size="sm" c="dimmed">No skills yet.</Text> : null}
      {skills?.map((skill) => (
        <Paper key={skill.id} withBorder radius="md" p="sm">
          <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
            <div style={{ minWidth: 0 }}>
              <Text fw={500} truncate>{skill.name}</Text>
              <Text size="xs" c="dimmed" lineClamp={2}>{skill.description}</Text>
            </div>
            <Group gap={4} wrap="nowrap">
              <Button size="xs" variant="subtle" onClick={() => setForm({ skill })}>Edit</Button>
              <Button size="xs" variant="subtle" color="red" onClick={() => void remove(skill)}>Delete</Button>
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
