"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/button";

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
  messages: { id: string; chat_id: string | null; body: string | null; type: string } | null;
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
        className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-4 light:bg-gray-100 light:border-gray-300"
      >
        <h2 className="text-sm font-semibold text-white light:text-gray-900">Novo Alerta</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Ex: Urgente cliente"
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-200 light:text-gray-900 light:placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">
              Palavras-chave <span className="text-gray-400 light:text-gray-600">(separadas por vírgula)</span>
            </label>
            <input
              type="text"
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              required
              placeholder="urgente, cancelar, problema"
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-200 light:text-gray-900 light:placeholder-gray-400"
            />
          </div>

          <div>
            <label htmlFor="alert-session" className="block text-xs text-gray-400 mb-1 light:text-gray-600">
              Sessão <span className="text-gray-400 light:text-gray-600">(opcional)</span>
            </label>
            <select
              id="alert-session"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-200 light:text-gray-900"
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

        <Button type="submit" variant="primary" size="md" disabled={loading}>
          {loading ? "Criando..." : "Criar Alerta"}
        </Button>
      </form>

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white light:text-gray-900">Alertas ativos</h2>
          {alerts.map((alert) => {
            const session = sessions.find((s) => s.id === alert.session_id);
            return (
              <div
                key={alert.id}
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 flex items-start justify-between gap-4 light:bg-gray-100 light:border-gray-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium light:text-gray-900">{alert.name}</span>
                    {session && (
                      <span className="text-xs text-gray-400 bg-gray-700 rounded px-2 py-0.5 light:text-gray-600 light:bg-gray-200">
                        {session.label}
                      </span>
                    )}
                    <span
                      className={`text-xs rounded px-2 py-0.5 ${
                        alert.active
                          ? "bg-green-900/50 text-green-400 light:bg-green-100 light:text-green-700"
                          : "bg-gray-700 text-gray-400 light:bg-gray-200 light:text-gray-600"
                      }`}
                    >
                      {alert.active ? "ativo" : "inativo"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {alert.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5 light:bg-gray-200 light:text-gray-700"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(alert)}
                    className="text-xs text-gray-400 hover:text-white transition-colors light:text-gray-600 light:hover:text-gray-900"
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white light:text-gray-900">Eventos recentes</h2>
            <Link
              href="/dashboard/admin/alerts/history"
              className="text-xs text-green-400 hover:text-green-300 transition-colors light:text-green-700"
            >
              Ver histórico completo →
            </Link>
          </div>
          {recentEvents.map((event) => {
            const chatId = event.messages?.chat_id;
            const msgId = event.messages?.id;
            const href = chatId ? `/dashboard/chat/${chatId}${msgId ? `?msg=${msgId}` : ""}` : null;
            const inner = (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-gray-400 light:text-gray-600">
                    Alerta:{" "}
                    <span className="text-white light:text-gray-900">{event.alerts?.name ?? event.alert_id}</span>
                  </span>
                  <span className="text-xs text-gray-400 light:text-gray-600">
                    {new Date(event.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-yellow-800/50 text-yellow-300 rounded px-2 py-0.5">
                    {event.matched_keyword}
                  </span>
                  {event.messages?.body && (
                    <span className="text-xs text-gray-400 truncate max-w-xs light:text-gray-600">
                      {event.messages.body}
                    </span>
                  )}
                </div>
              </>
            );
            const cls = `block rounded-lg border px-4 py-3 ${
              event.seen ? "bg-gray-800 border-gray-700 light:bg-gray-100 light:border-gray-300" : "bg-yellow-900/20 border-yellow-800/50 light:bg-yellow-50 light:border-yellow-300"
            } ${href ? "hover:border-green-700 transition-colors cursor-pointer" : ""}`;
            return href ? (
              <Link key={event.id} href={href} className={cls}>{inner}</Link>
            ) : (
              <div key={event.id} className={cls}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
