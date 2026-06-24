"use client";

import { useState } from "react";

interface Integration {
  id: string;
  type: string;
  label: string | null;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

interface Props {
  integrations: Integration[];
  tenantId: string;
}

const INTEGRATION_TYPES = [
  { value: "openai", label: "OpenAI", fields: [{ key: "api_key", label: "API Key", type: "password" }] },
  { value: "webhook", label: "Webhook externo", fields: [{ key: "url", label: "URL", type: "text" }, { key: "secret", label: "Secret (opcional)", type: "password" }] },
  { value: "monday", label: "Monday.com", fields: [{ key: "api_key", label: "API Key", type: "password" }, { key: "board_id", label: "Board ID", type: "text" }] },
  { value: "hubspot", label: "HubSpot", fields: [{ key: "api_key", label: "API Key", type: "password" }] },
];

export default function IntegrationsManager({ integrations: initial, tenantId }: Props) {
  const [integrations, setIntegrations] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("openai");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = INTEGRATION_TYPES.find((t) => t.value === type)!;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, type, label: label || selectedType.label, config: fields }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json();
      setIntegrations((prev) => [...prev, data]);
      setAdding(false);
      setLabel("");
      setFields({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/integrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, active: !active } : i))
    );
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta integração?")) return;
    await fetch(`/api/integrations/${id}`, { method: "DELETE" });
    setIntegrations((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-4">
      {integrations.length === 0 && !adding && (
        <p className="text-sm text-gray-500">Nenhuma integração configurada.</p>
      )}

      {integrations.map((integration) => (
        <div
          key={integration.id}
          className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between"
        >
          <div>
            <p className="text-sm font-medium text-white">{integration.label ?? integration.type}</p>
            <p className="text-xs text-gray-500 capitalize">{integration.type}</p>
            {typeof integration.config["api_key"] === "string" && (
              <p className="text-xs text-gray-600 font-mono mt-0.5">
                ••••••••{integration.config["api_key"].slice(-4)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleToggle(integration.id, integration.active)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                integration.active
                  ? "border-green-700 text-green-400 hover:bg-green-900/30"
                  : "border-gray-700 text-gray-500 hover:bg-gray-800"
              }`}
            >
              {integration.active ? "Ativo" : "Inativo"}
            </button>
            <button
              onClick={() => handleDelete(integration.id)}
              className="text-xs text-red-500 hover:text-red-400 px-2 py-1 transition-colors"
            >
              Remover
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tipo</label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setFields({}); }}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              {INTEGRATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Label (opcional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={selectedType.label}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          {selectedType.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
              <input
                type={field.type}
                value={fields[field.key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500 font-mono"
              />
            </div>
          ))}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setAdding(false); setError(null); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-md transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-2 px-4 border border-dashed border-gray-700 text-gray-400 hover:border-green-600 hover:text-green-400 text-sm rounded-md transition-colors"
        >
          + Adicionar integração
        </button>
      )}
    </div>
  );
}
