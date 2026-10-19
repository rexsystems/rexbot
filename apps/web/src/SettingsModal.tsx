import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconDeviceFloppy, IconKey, IconX } from "./icons";
import type { ClientSettings } from "@rex/shared";

export function SettingsModal(props: {
  initial: ClientSettings;
  onSave: (s: ClientSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(props.initial);

  return (
    <Modal
      opened
      onClose={props.onClose}
      closeButtonProps={{ "aria-label": "Close settings" }}
      title={
        <Group gap="sm">
          <IconKey size={36} stroke={1.5} />
          <Text fw={600}>Settings</Text>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          Keys are saved in this browser and sent to the local API when you use them.
        </Text>

        <PasswordInput
          label="LLM API key"
          value={form.llmApiKey}
          onChange={(e) => setForm({ ...form, llmApiKey: e.currentTarget.value })}
          autoComplete="off"
          visibilityToggleButtonProps={{ "aria-label": "Toggle LLM key visibility" }}
        />
        <TextInput
          label="LLM base URL"
          value={form.llmBaseUrl}
          onChange={(e) => setForm({ ...form, llmBaseUrl: e.currentTarget.value })}
          placeholder="https://api.deepseek.com"
        />
        <TextInput
          label="Model"
          value={form.llmModel}
          onChange={(e) => setForm({ ...form, llmModel: e.currentTarget.value })}
        />
        <Text fw={600} mt="sm">Google AI Studio</Text>
        <PasswordInput label="Google AI Studio API key" description="Used for Gemini embeddings and live voice." value={form.googleApiKey ?? ""} onChange={(event) => setForm({ ...form, googleApiKey: event.currentTarget.value })} autoComplete="off" visibilityToggleButtonProps={{ "aria-label": "Toggle Google key visibility" }} />
        <TextInput label="Live voice model" value={form.liveModel ?? "gemini-3.8-live"} onChange={(event) => setForm({ ...form, liveModel: event.currentTarget.value })} />
        <Select label="Embedding provider" value={form.embeddingProvider ?? "google"} data={[{ value: "google", label: "Google AI Studio" }, { value: "openai", label: "Chat provider (OpenAI compatible)" }]} allowDeselect={false} onChange={(value) => setForm({ ...form, embeddingProvider: value as "google" | "openai", embeddingModel: value === "google" ? "gemini-embedding-2" : "text-embedding-3-small" })} />
        <TextInput
          label="Embedding model"
          value={form.embeddingModel}
          onChange={(e) =>
            setForm({ ...form, embeddingModel: e.currentTarget.value })
          }
        />
        <PasswordInput
          label="Tavily search API key"
          value={form.searchApiKey}
          onChange={(e) =>
            setForm({ ...form, searchApiKey: e.currentTarget.value })
          }
          autoComplete="off"
          visibilityToggleButtonProps={{ "aria-label": "Toggle search key visibility" }}
        />

        <Group justify="flex-end" mt="sm">
          <Button
            variant="default"
            leftSection={<IconX size={28} stroke={1.5} />}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={28} stroke={1.5} />}
            onClick={() => props.onSave(form)}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
