"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import Button from "@/components/ui/button";

type Period = "last50" | "today" | "7d" | "30d" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  last50: "Últimas 50 mensagens",
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  all: "Conversa inteira",
};

export default function ConversationSummary({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("last50");
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ messageCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/chats/${chatId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, focus: focus.trim() || undefined }),
      });
      const data = await res.json() as { summary?: string; messageCount?: number; error?: string };
      if (res.status === 503) throw new Error("IA não configurada. Peça ao administrador para ativá-la em Configurações.");
      if (!res.ok) throw new Error(data.error ?? "Falha ao gerar resumo");
      setSummary(data.summary ?? "");
      setMeta({ messageCount: data.messageCount ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Resumir conversa (IA)"
        className="shrink-0 flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 border border-green-800/60 hover:border-green-700 rounded-md px-2 py-1 transition-colors light:text-green-700"
      >
        <Sparkles size={13} />
        Resumir
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl light:bg-white light:border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 light:border-gray-200">
              <h2 className="text-sm font-medium text-white flex items-center gap-2 light:text-gray-900">
                <Sparkles size={15} className="text-green-400 light:text-green-700" />
                Resumo da conversa
              </h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white transition-colors light:text-gray-600 light:hover:text-gray-900">
                <X size={18} />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-800 space-y-2 light:border-gray-200">
              <div className="flex items-center gap-2">
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as Period)}
                  disabled={loading}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-100 light:border-gray-300 light:text-gray-900"
                >
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                  ))}
                </select>
                <Button variant="primary" size="md" onClick={generate} disabled={loading} className="shrink-0">
                  {loading ? "Gerando..." : "Gerar"}
                </Button>
              </div>
              <input
                type="text"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !loading) generate(); }}
                disabled={loading}
                placeholder="Foco (opcional): ex. tudo sobre preços / entrega / reclamações"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-100 light:border-gray-300 light:text-gray-900 light:placeholder-gray-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {error && (
                <p className="text-sm px-3 py-2 rounded-md border bg-red-900/30 border-red-800 text-red-400">{error}</p>
              )}
              {loading && !summary && (
                <p className="text-sm text-gray-400 animate-pulse light:text-gray-600">Analisando a conversa...</p>
              )}
              {!loading && !summary && !error && (
                <p className="text-sm text-gray-400 light:text-gray-600">Escolha um período e clique em Gerar.</p>
              )}
              {summary && (
                <>
                  <SummaryRender text={summary} />
                  {meta && (
                    <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-800 light:text-gray-600 light:border-gray-200">
                      Baseado em {meta.messageCount} mensagens · {PERIOD_LABELS[period]}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Render leve de markdown: **negrito** vira título; linhas - viram bullets.
function SummaryRender({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm text-gray-200">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="h-1" />;
        const header = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
        if (header) {
          return (
            <p key={i}>
              <span className="font-semibold text-green-400 light:text-green-700">{header[1]}</span>
              {header[2] ? <span className="text-gray-200">: {header[2]}</span> : null}
            </p>
          );
        }
        if (line.startsWith("-") || line.startsWith("•") || line.startsWith("*")) {
          return <p key={i} className="pl-3 text-gray-300 light:text-gray-700">• {line.replace(/^[-•*]\s*/, "")}</p>;
        }
        return <p key={i} className="text-gray-300 light:text-gray-700">{line}</p>;
      })}
    </div>
  );
}
