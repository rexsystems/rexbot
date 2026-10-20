import { useEffect, useState } from "react";
import { Group, Select } from "@mantine/core";
import type { ModelChoice, ProviderModel, ProviderState } from "@rex/shared";
import * as api from "./api";
import { ModelSelect } from "./ModelsPanel";

const DEFAULT = "__active__";

/** Lets one bot use its own provider and model instead of the owner's active one. */
export function BotModelPicker({ value, onChange }: { value?: ModelChoice; onChange: (value: ModelChoice | undefined) => void }) {
  const [state, setState] = useState<ProviderState | null>(null);
  const [models, setModels] = useState<ProviderModel[]>([]);
  useEffect(() => { api.providers.state().then(setState).catch(() => setState({ connections: [], active: null })); }, []);
  const connection = state?.connections.find((entry) => entry.id === value?.connectionId);
  useEffect(() => {
    setModels([]);
    if (connection) api.providers.models({ connectionId: connection.id }).then((result) => setModels(result.models)).catch(() => undefined);
  }, [connection?.id]);
  if (!state || state.connections.length === 0) return null;
  const active = state.connections.find((entry) => entry.id === state.active?.connectionId);
  return (
    <Group grow align="flex-start" wrap="wrap" style={{ rowGap: 8 }}>
      <Select
        label="Model"
        description={connection ? undefined : active && state.active ? `Uses your active model: ${state.active.model}` : "Uses your active model"}
        data={[{ value: DEFAULT, label: "My active model" }, ...state.connections.map((entry) => ({ value: entry.id, label: entry.label }))]}
        value={connection?.id ?? DEFAULT}
        allowDeselect={false}
        onChange={(next) => {
          const picked = state.connections.find((entry) => entry.id === next);
          onChange(picked ? { connectionId: picked.id, model: picked.defaultModel } : undefined);
        }}
        comboboxProps={{ withinPortal: true }}
        miw={180}
      />
      {connection ? <ModelSelect label="Model id" models={models} value={value?.model ?? ""} onChange={(model) => onChange(model ? { connectionId: connection.id, model } : undefined)} /> : null}
    </Group>
  );
}
