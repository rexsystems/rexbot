import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, PasswordInput, Select, SimpleGrid, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { PROVIDERS, providerInfo, type ProviderConnection, type ProviderId, type ProviderModel, type ProviderState } from "@rex/shared";
import * as api from "./api";
import { CursorCard } from "./CursorCard";
import { ProviderLogo } from "./ProviderLogo";
import { useSession } from "./session";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A model picker that offers the provider's live model list and still accepts a typed id. */
export function ModelSelect({ label, description, models, value, onChange, loading }: { label: string; description?: string; models: ProviderModel[]; value: string; onChange: (value: string) => void; loading?: boolean }) {
  const [search, setSearch] = useState(value);
  useEffect(() => setSearch(value), [value]);
  const data = useMemo(() => {
    const ids = models.map((model) => ({ value: model.id, label: model.name ? `${model.name} · ${model.id}` : model.id }));
    if (value && !models.some((model) => model.id === value)) ids.unshift({ value, label: value });
    return ids;
  }, [models, value]);
  return (
    <Select
      label={label}
      description={description}
      placeholder={models.length ? "Search models" : "Type a model id"}
      data={data}
      value={value || null}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(next) => onChange(next ?? "")}
      onBlur={() => { if (search.trim() && search.trim() !== value && !data.some((item) => item.label === search)) onChange(search.trim()); }}
      nothingFoundMessage={search.trim() ? `Use "${search.trim()}"` : "No models"}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      maxDropdownHeight={260}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function ConnectForm({ provider, existing, onDone, onCancel }: { provider: ProviderId; existing?: ProviderConnection; onDone: (state: ProviderState) => void; onCancel: () => void }) {
  const info = providerInfo(provider);
  const admin = useSession().user.role === "admin";
  const [label, setLabel] = useState(existing?.label ?? (info.id === "custom" ? "" : info.name));
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? info.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(existing?.defaultModel ?? "");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editableUrl = info.id === "custom" || info.local || Boolean(info.baseUrlEditable) || Boolean(existing);

  async function check() {
    setChecking(true);
    setError(null);
    setChecked(null);
    try {
      const result = await api.providers.models(existing && !apiKey.trim() && baseUrl === existing.baseUrl ? { connectionId: existing.id } : { provider, baseUrl, apiKey: apiKey.trim() });
      setModels(result.models);
      setChecked(result.models.length ? `Connected. ${result.models.length} models available.` : "Connected, but the provider listed no models. Type a model id.");
      if (!model && result.models[0]) setModel(result.models[0].id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { if (existing) void check(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.providers.save({ id: existing?.id, provider, label: label.trim() || info.name, baseUrl, apiKey: apiKey.trim() || undefined, defaultModel: model });
      onDone(result.state);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap">
          <ProviderLogo provider={provider} size={44} />
          <div>
            <Text fw={600}>{existing ? `Edit ${existing.label}` : `Connect ${info.name}`}</Text>
            <Text size="sm" c="dimmed">{info.blurb}</Text>
          </div>
        </Group>
        {info.id === "custom" || existing ? <TextInput label="Name" value={label} onChange={(event) => setLabel(event.currentTarget.value)} maxLength={60} placeholder={info.name} /> : null}
        {editableUrl ? (
          <TextInput
            label="Base URL"
            description={
              info.id === "bedrock-mantle"
                ? "Match the Region of your Bedrock API key. Grok needs …/openai/v1 (not bare /v1)."
                : info.local
                  ? (admin ? "Where the local server listens, as seen from the Rex server." : "Only admins can connect local servers.")
                  : "The address that serves /chat/completions and /models."
            }
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
            placeholder="https://api.example.com/v1"
            required
          />
        ) : null}
        <PasswordInput
          label={info.keyRequired ? "API key" : "API key (optional)"}
          description={existing?.keyHint ? `Saved key ends in ${existing.keyHint.slice(1)}. Leave empty to keep it.` : info.keyUrl ? <>Create one at <Anchor href={info.keyUrl} target="_blank" rel="noreferrer" size="xs">{new URL(info.keyUrl).host}</Anchor>. It's encrypted on the server and never shown again.</> : "Stored encrypted on the server."}
          value={apiKey}
          onChange={(event) => { setApiKey(event.currentTarget.value); setChecked(null); }}
          autoComplete="off"
          visibilityToggleButtonProps={{ "aria-label": "Toggle key visibility" }}
        />
        <Group gap="sm">
          <Button variant="light" size="sm" loading={checking} disabled={info.keyRequired && !apiKey.trim() && !existing?.keyHint} onClick={() => void check()}>Check and load models</Button>
          {checked ? <Text size="sm" c="green.4" role="status">{checked}</Text> : null}
        </Group>
        <ModelSelect label="Default model" description="Bots use this unless you pick another for a bot." models={models} value={model} onChange={setModel} loading={checking} />
        {error ? <Alert color="red" variant="light" role="alert">{error}</Alert> : null}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!model.trim() || (info.keyRequired && !apiKey.trim() && !existing?.keyHint)}>{existing ? "Save" : "Connect"}</Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ModelsPanel({ onChange }: { onChange?: (state: ProviderState) => void }) {
  const [state, setState] = useState<ProviderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ provider: ProviderId; existing?: ProviderConnection } | null>(null);
  const [activeModels, setActiveModels] = useState<ProviderModel[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (next: ProviderState) => { setState(next); onChange?.(next); };

  useEffect(() => { api.providers.state().then(update).catch((err) => setError(errorText(err))); }, []);

  const activeConnection = state?.connections.find((connection) => connection.id === state.active?.connectionId);
  useEffect(() => {
    setActiveModels([]);
    if (activeConnection) api.providers.models({ connectionId: activeConnection.id }).then((result) => setActiveModels(result.models)).catch(() => setActiveModels([]));
  }, [activeConnection?.id]);

  async function setActive(connectionId: string, model: string) {
    setBusy(true);
    try { update(await api.providers.setActive({ connectionId, model })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  async function remove(connection: ProviderConnection) {
    if (!window.confirm(`Remove ${connection.label}? Its key is deleted from the server. Bots that use it switch to your active model.`)) return;
    try { update(await api.providers.remove(connection.id)); }
    catch (err) { setError(errorText(err)); }
  }

  if (!state) return error ? <Alert color="red" variant="light">{error}</Alert> : <Group justify="center" py="lg"><Loader aria-label="Loading providers" /></Group>;

  if (form) {
    return <ConnectForm provider={form.provider} existing={form.existing} onCancel={() => setForm(null)} onDone={(next) => { update(next); setForm(null); }} />;
  }

  return (
    <Stack gap="lg">
      {error ? <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>{error}</Alert> : null}
      {state.connections.length ? (
        <Stack gap="sm">
          <Text fw={600}>Active model</Text>
          <Group grow align="flex-end" wrap="wrap" style={{ rowGap: 8 }}>
            <Select
              label="Provider"
              data={state.connections.map((connection) => ({ value: connection.id, label: connection.label }))}
              value={state.active?.connectionId ?? null}
              allowDeselect={false}
              disabled={busy}
              onChange={(value) => { const next = state.connections.find((connection) => connection.id === value); if (next) void setActive(next.id, next.defaultModel); }}
              comboboxProps={{ withinPortal: true }}
              miw={180}
            />
            {activeConnection ? <ModelSelect label="Model" models={activeModels} value={state.active?.model ?? ""} onChange={(model) => { if (model) void setActive(activeConnection.id, model); }} /> : null}
          </Group>
          <Text size="xs" c="dimmed">New replies use this model. Give a bot its own model in the bot editor.</Text>
        </Stack>
      ) : (
        <Alert color="ember" variant="light" title="Connect a model to start">
          Rex needs a model provider to answer. Keys are stored encrypted on this server, per account.
        </Alert>
      )}

      {state.connections.length ? (
        <Stack gap="xs">
          <Text fw={600}>Connected</Text>
          {state.connections.map((connection) => {
            const info = providerInfo(connection.provider);
            const active = connection.id === state.active?.connectionId;
            return (
              <Paper key={connection.id} className={`provider-card${active ? " active" : ""}`} withBorder radius="md" p="sm">
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ProviderLogo provider={connection.provider} size={40} />
                    <div style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap"><Text fw={500} truncate>{connection.label}</Text>{active ? <Badge size="xs" variant="light">Active</Badge> : null}</Group>
                      <Text size="xs" c="dimmed" truncate>{connection.defaultModel || "No default model"}{connection.keyHint ? ` · key ${connection.keyHint}` : info.keyRequired ? "" : " · no key"}</Text>
                    </div>
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" variant="subtle" onClick={() => setForm({ provider: connection.provider, existing: connection })}>Edit</Button>
                    <Button size="xs" variant="subtle" color="red" onClick={() => void remove(connection)}>Remove</Button>
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      ) : null}

      <Stack gap="xs">
        <Text fw={600}>{state.connections.length ? "Add another provider" : "Choose a provider"}</Text>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
          {PROVIDERS.map((provider) => (
            <UnstyledButton key={provider.id} className="provider-tile" onClick={() => setForm({ provider: provider.id })} aria-label={`Connect ${provider.name}`}>
              <ProviderLogo provider={provider.id} size={36} />
              <div style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap"><Text size="sm" fw={500} truncate>{provider.name}</Text>{provider.local ? <Badge size="xs" variant="outline" color="gray">Local</Badge> : null}</Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{provider.blurb}</Text>
              </div>
            </UnstyledButton>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          Claude Pro/Max and ChatGPT Plus/Pro subscriptions can't be used here yet: Anthropic only allows API keys for apps like this,
          and OpenAI's Sign in with ChatGPT for plan usage is a preview for apps running on your own computer. Use an API key from either console.
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>Tools</Text>
        <CursorCard />
      </Stack>
    </Stack>
  );
}
