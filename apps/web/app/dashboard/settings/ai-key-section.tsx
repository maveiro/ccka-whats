"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/button";

type Source = "byok" | "platform" | null;

interface Feature {
  name: string;
  description: string;
}

interface Props {
  hasKey: boolean;
  source: Source;
  maskedKey: string | null;
  features: Feature[];
}

const REASON_TEXT: Record<string, string> = {
  invalid: "Chave inválida ou revogada.",
  no_quota: "Chave válida, mas sem créditos/quota na OpenAI.",
  network: "Não foi possível contatar a OpenAI (rede).",
};

export default function AiKeySection({ hasKey, source, maskedKey, features }: Props) {
  const router = useRouter();
  const [showInput, setShowInput] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tenant/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiKey ? { apiKey } : {}),
      });
      const data = await res.json() as { ok: boolean; reason?: string };
      if (data.ok) setMsg({ type: "ok", text: "Conexão com a OpenAI OK." });
      else setMsg({ type: "err", text: REASON_TEXT[data.reason ?? "invalid"] ?? "Falha ao testar." });
    } catch {
      setMsg({ type: "err", text: "Erro ao testar a conexão." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tenant/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; reason?: string };
      if (!res.ok) {
        throw new Error(data.reason ? REASON_TEXT[data.reason] ?? data.error : data.error ?? "Erro ao salvar");
      }
      setApiKey("");
      setShowInput(false);
      router.refresh();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Erro ao salvar" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remover sua chave OpenAI? A IA voltará a usar a chave do plano (se houver).")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tenant/ai", { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 light:bg-white light:border-gray-200">
      <div>
        <h2 className="text-sm font-medium text-gray-300 light:text-gray-700">Inteligência Artificial</h2>
        <p className="text-xs text-gray-400 mt-0.5 light:text-gray-600">
          {source === "byok"
            ? "Usando a sua chave OpenAI."
            : source === "platform"
              ? "IA ativada pelo plano."
              : "IA não configurada."}
        </p>
      </div>

      {/* Status por feature */}
      <div className="space-y-2">
        {features.map((f) => (
          <div key={f.name} className="flex items-start gap-3">
            <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-green-500" : "bg-gray-600"}`} />
            <div>
              <p className={`text-sm ${hasKey ? "text-white light:text-gray-900" : "text-gray-400 light:text-gray-600"}`}>{f.name}</p>
              <p className="text-xs text-gray-400 light:text-gray-600">{f.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* BYOK */}
      <div className="border-t border-gray-800 pt-3 space-y-3 light:border-gray-200">
        {source === "byok" && maskedKey && !showInput && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-400 light:text-gray-600">
              Sua chave: <span className="text-white font-mono light:text-gray-900">{maskedKey}</span>
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => setShowInput(true)} disabled={busy}
                className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-40 light:text-gray-600 light:hover:text-gray-900">
                Substituir
              </button>
              <button onClick={handleRemove} disabled={busy}
                className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40">
                Remover
              </button>
            </div>
          </div>
        )}

        {source !== "byok" && !showInput && (
          <button onClick={() => setShowInput(true)}
            className="text-xs text-green-400 hover:text-green-300 transition-colors light:text-green-700">
            Usar minha própria chave (BYOK) →
          </button>
        )}

        {showInput && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Chave OpenAI (sk-...)</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-100 light:border-gray-300 light:text-gray-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="md" onClick={handleSave} disabled={busy || !apiKey.trim()}>
                {busy ? "Salvando..." : "Salvar"}
              </Button>
              <Button variant="secondary" size="md" onClick={handleTest} disabled={busy}>
                Testar conexão
              </Button>
              <button onClick={() => { setShowInput(false); setApiKey(""); setMsg(null); }} disabled={busy}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors ml-auto light:text-gray-600 light:hover:text-gray-700">
                Cancelar
              </button>
            </div>
            <p className="text-xs text-gray-400 light:text-gray-600">
              A chave é validada antes de salvar e nunca é exibida novamente — só os últimos 4 dígitos.
            </p>
          </div>
        )}

        {msg && (
          <p className={`text-sm px-3 py-2 rounded-md border ${
            msg.type === "ok"
              ? "bg-green-900/30 border-green-800 text-green-400 light:bg-green-50 light:border-green-300 light:text-green-700"
              : "bg-red-900/30 border-red-800 text-red-400 light:bg-red-50 light:border-red-300 light:text-red-700"
          }`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
