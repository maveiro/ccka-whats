"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Alert {
  id: string;
  name: string;
  keywords: string[];
  active: boolean;
  session_id: string | null;
  created_at: string;
}

interface Session {
  id: string;
  label: string;
}

interface AlertEvent {
  id: string;
  matched_keyword: string;
  seen: boolean;
  created_at: string;
  alert_id: string;
  alerts: { name: string } | null;
  messages: { body: string | null; type: string } | null;
}

interface AlertsManagerProps {
  initialAlerts: Alert[];
  sessions: Session[];
  recentEvents: AlertEvent[];
}

export default function AlertsManager({
  initialAlerts,
  sessions,
  recentEvents,
}: AlertsManagerProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [name, setName] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const keywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (keywords.length === 0) {
      setError("Informe ao menos uma palavra-chave");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, keywords, sessionId: sessionId || undefined }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Erro ao criar alerta");
        return;
      }

      const created = await res.json() as Alert;
      setAlerts((prev) => [created, ...prev]);
      setName("");
      setKeywordsInput("");
      setSessionId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(alert: Alert) {
    const res = await fetch(`/api/alerts/${alert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !alert.active }),
    });

    if (res.ok) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? { ...a, active: !a.active } : a)),
      );
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold text-white">Novo Alerta</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Ex: Urgente cliente"
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Palavras-chave <span className="text-gray-500">(separadas por vírgula)</span>
            </label>
            <input
              type="text"
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              required
              placeholder="urgente, cancelar, problema"
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Sessão <span className="text-gray-500">(opcional)</span>
            </label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="">Todas as sessões</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          {loading ? "Criando..." : "Criar Alerta"}
        </button>
      </form>

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Alertas ativos</h2>
          {alerts.map((alert) => {
            const session = sessions.find((s) => s.id === alert.session_id);
            return (
              <div
                key={alert.id}
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium">{alert.name}</span>
                    {session && (
                      <span className="text-xs text-gray-400 bg-gray-700 rounded px-2 py-0.5">
                        {session.label}
                      </span>
                    )}
                    <span
                      className={`text-xs rounded px-2 py-0.5 ${
                        alert.active
                          ? "bg-green-900/50 text-green-400"
                          : "bg-gray-700 text-gray-500"
                      }`}
                    >
                      {alert.active ? "ativo" : "inativo"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {alert.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(alert)}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    {alert.active ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => handleDelete(alert.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Eventos recentes</h2>
          {recentEvents.map((event) => (
            <div
              key={event.id}
              className={`rounded-lg border px-4 py-3 ${
                event.seen
                  ? "bg-gray-800 border-gray-700"
                  : "bg-yellow-900/20 border-yellow-800/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-gray-400">
                  Alerta:{" "}
                  <span className="text-white">{event.alerts?.name ?? event.alert_id}</span>
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(event.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-xs bg-yellow-800/50 text-yellow-300 rounded px-2 py-0.5">
                  {event.matched_keyword}
                </span>
                {event.messages?.body && (
                  <span className="text-xs text-gray-400 truncate max-w-xs">
                    {event.messages.body}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
