"use client";

import { useState } from "react";

interface Session {
  id: string;
  label: string | null;
  phone_number: string;
  evolution_instance_name: string | null;
}

export default function HistorySyncForm({ sessions }: { sessions: Session[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [limit, setLimit] = useState("200");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ started: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/history-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, limit: parseInt(limit) }),
      });

      if (!res.ok) {
        throw new Error(`Erro ${res.status}: ${await res.text()}`);
      }

      await res.json();
      setResult({ started: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-5">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Número WhatsApp</label>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? s.phone_number} ({s.phone_number})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Máximo de mensagens por conversa
          </label>
          <select
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="100">100 mensagens</option>
            <option value="200">200 mensagens</option>
            <option value="500">500 mensagens</option>
            <option value="1000">1000 mensagens</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSync}
        disabled={loading || !sessionId}
        className="w-full py-2 px-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {loading ? "Importando... (pode levar alguns minutos)" : "Importar histórico"}
      </button>

      {result?.started && (
        <div className="bg-green-900/30 border border-green-800 rounded-md p-3 text-sm text-green-300">
          Importação iniciada em background. Pode fechar esta página — as mensagens aparecem gradualmente nas conversas.
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-md p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-600">
        A importação é segura para repetir — mensagens duplicadas são ignoradas automaticamente.
      </p>
    </div>
  );
}
