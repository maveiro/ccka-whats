"use client";

import { useState } from "react";

interface CreateSessionFormProps {
  onCreated: () => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

export default function CreateSessionForm({ onCreated }: CreateSessionFormProps) {
  const [label, setLabel] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleLabelChange(val: string) {
    setLabel(val);
    setInstanceName(slugify(val));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, phoneNumber, instanceName }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Erro ao criar sessão");
        return;
      }

      setLabel("");
      setPhoneNumber("");
      setInstanceName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-4 max-w-2xl"
    >
      <h2 className="text-sm font-semibold text-white">Nova Sessão</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            required
            placeholder="Ex: Comercial SP"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Número WhatsApp</label>
          <input
            type="text"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            required
            placeholder="+55 11 99999-9999"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Nome da Instância</label>
          <input
            type="text"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            required
            placeholder="comercial-sp"
            className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <p className="text-xs text-gray-500 mt-1">Auto-gerado a partir do label. Apenas letras, números e hífens.</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          {loading ? "Criando..." : "Criar Sessão"}
        </button>
      </div>
    </form>
  );
}
