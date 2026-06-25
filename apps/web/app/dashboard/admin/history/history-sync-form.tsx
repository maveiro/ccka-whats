"use client";

import { useState, useEffect, useRef } from "react";

interface Session {
  id: string;
  label: string | null;
  phone_number: string;
  evolution_instance_name: string | null;
}

interface SyncResult {
  totalImported: number;
  chats: number;
}

type SyncStatus = "idle" | "starting" | "running" | "completed" | "error";

export default function HistorySyncForm({ sessions }: { sessions: Session[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [limit, setLimit] = useState("200");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [chatsFound, setChatsFound] = useState<number | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sinceRef = useRef<string | null>(null);

  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  async function pollStatus() {
    if (!sinceRef.current || !sessionId) return;

    try {
      const res = await fetch(
        `/api/history-sync/status?sessionId=${sessionId}&since=${encodeURIComponent(sinceRef.current)}`,
      );
      if (!res.ok) return;

      const data = await res.json() as {
        status: "pending" | "running" | "completed";
        result: Record<string, number> | null;
        errors: string[];
      };

      if (data.status === "running") {
        setStatus("running");
        // Capturar chatsFound do evento started
        if (data.result) setChatsFound((data.result as Record<string, number>).chats ?? null);
      }

      if (data.status === "completed" && data.result) {
        setStatus("completed");
        setResult({ totalImported: data.result.totalImported, chats: data.result.chats });
        if (data.errors.length > 0) setErrors(data.errors.slice(0, 5));
        stopPolling();
      }
    } catch {
      // Ignorar erros de polling
    }
  }

  async function handleSync() {
    setStatus("starting");
    setResult(null);
    setErrors([]);
    setChatsFound(null);
    stopPolling();

    try {
      sinceRef.current = new Date().toISOString();

      const res = await fetch("/api/history-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, limit: parseInt(limit) }),
      });

      if (!res.ok) {
        const text = await res.text();
        setStatus("error");
        setErrors([`Erro ${res.status}: ${text}`]);
        return;
      }

      setStatus("running");

      // Polling a cada 4 segundos
      pollingRef.current = setInterval(pollStatus, 4000);
      // Primeira checagem imediata após 2s
      setTimeout(pollStatus, 2000);
    } catch (err) {
      setStatus("error");
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }

  const loading = status === "starting" || status === "running";

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
        {status === "starting" && "Iniciando..."}
        {status === "running" && (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
            {chatsFound != null
              ? `Importando ${chatsFound} conversas...`
              : "Importando histórico..."}
          </span>
        )}
        {(status === "idle" || status === "completed" || status === "error") &&
          "Importar histórico"}
      </button>

      {/* Estado running sem chatsFound ainda */}
      {status === "running" && chatsFound == null && (
        <p className="text-xs text-gray-500 text-center">
          Aguardando início — pode levar alguns segundos...
        </p>
      )}

      {/* Resultado */}
      {status === "completed" && result && (
        <div className="bg-green-900/30 border border-green-800 rounded-md p-4 space-y-1">
          <p className="text-sm font-medium text-green-300">Importação concluída</p>
          <p className="text-sm text-green-400">
            {result.totalImported.toLocaleString("pt-BR")} mensagens importadas
            {" "}de {result.chats.toLocaleString("pt-BR")} conversas
          </p>
          {errors.length > 0 && (
            <p className="text-xs text-yellow-400 mt-1">
              {errors.length} erro(s) durante o processo (mensagens individuais ignoradas)
            </p>
          )}
        </div>
      )}

      {/* Erro ao iniciar */}
      {status === "error" && errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-800 rounded-md p-3 text-sm text-red-300">
          {errors[0]}
        </div>
      )}

      <p className="text-xs text-gray-600">
        A importação é segura para repetir — mensagens duplicadas são ignoradas automaticamente.
      </p>
    </div>
  );
}
