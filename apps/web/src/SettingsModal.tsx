import { useState } from "react";
import {
  Accordion,
  Tabs,
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
import type { ClientSettings, ProviderState } from "@rex/shared";
import { ModelsPanel } from "./ModelsPanel";

export function SettingsModal(props: {
  initial: ClientSettings;
  onSave: (s: ClientSettings) => void;
  onClose: () => void;
  onProviders?: (state: ProviderState) => void;
}) {
  const [form, setForm] = useState(props.initial);
  const [tab, setTab] = useState<string | null>("models");

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
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="models">Models</Tabs.Tab>
          <Tabs.Tab value="voice">Voice and memory</Tabs.Tab>
          <Tabs.Tab value="search">Web search</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="models">
          <Stack gap="lg">
            <ModelsPanel onChange={props.onProviders} />
            <Accordion variant="contained" radius="md">
              <Accordion.Item value="browser">
                <Accordion.Control>Key saved in this browser (older setup)</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    <Text c="dimmed" size="sm">Used only when you have no provider connected above. It stays in this browser and is sent with each message.</Text>
                    <PasswordInput
                      label="LLM API key"
                      value={form.llmApiKey}
                      onChange={(e) => setForm({ ...form, llmApiKey: e.currentTarget.value })}
                      autoComplete="off"
                      visibilityToggleButtonProps={{ "aria-label": "Toggle LLM key visibility" }}
                    />
                    <TextInput label="LLM base URL" value={form.llmBaseUrl} onChange={(e) => setForm({ ...form, llmBaseUrl: e.currentTarget.value })} placeholder="https://api.deepseek.com" />
                    <TextInput label="Model" value={form.llmModel} onChange={(e) => setForm({ ...form, llmModel: e.currentTarget.value })} />
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="voice">
      <Stack gap="md">
        <Text c="dimmed" size="sm">Google AI Studio powers live voice calls and memory embeddings. The key is saved in this browser.</Text>
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
      </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="search">
          <Stack gap="md">
            <Text c="dimmed" size="sm">Bots search the web through Tavily. The key is saved in this browser.</Text>
        <PasswordInput
          label="Tavily search API key"
          value={form.searchApiKey}
          onChange={(e) =>
            setForm({ ...form, searchApiKey: e.currentTarget.value })
          }
          autoComplete="off"
          visibilityToggleButtonProps={{ "aria-label": "Toggle search key visibility" }}
        />

          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Stack gap="md">
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
