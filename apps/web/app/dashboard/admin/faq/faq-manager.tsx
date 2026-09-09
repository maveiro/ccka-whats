"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Item {
  id: string;
  artista: string | null;
  pergunta: string;
  resposta: string;
  ordem: number;
  ativo: boolean;
  updated_at: string;
}

export default function FaqManager({
  initial,
  artistas,
  isAdmin,
}: {
  initial: Item[];
  artistas: string[];
  isAdmin: boolean;
}) {
  const [itens, setItens] = useState(initial);
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState("");
  const [artista, setArtista] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!pergunta.trim() || !resposta.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pergunta, resposta,
          artista: artista || null,
          ordem: (itens.at(-1)?.ordem ?? 0) + 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      setItens((is) => [...is, json]);
      setPergunta(""); setResposta("");
      toast.success("Pergunta adicionada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function atualizar(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/faq/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao salvar");
      return;
    }
    setItens((is) => is.map((i) => (i.id === id ? json : i)));
  }

  async function remover(id: string) {
    if (!confirm("Remover esta pergunta da central?")) return;
    const res = await fetch(`/api/faq/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao remover");
      return;
    }
    setItens((is) => is.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-8">
      <form onSubmit={adicionar} className="border border-gray-800 rounded p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Nova pergunta</h2>
        <input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Ex: Tem meia-entrada?"
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
        />
        <textarea
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          rows={3}
          placeholder="Resposta que o fã vai ler no WhatsApp"
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
        />
        <div className="flex items-center gap-3">
          <select
            value={artista}
            onChange={(e) => setArtista(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="">Todos os artistas</option>
            {artistas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            type="submit"
            disabled={salvando || !pergunta.trim() || !resposta.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5"
          >
            {salvando ? "Salvando…" : "Adicionar"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white">
          Perguntas <span className="text-gray-500 font-normal">({itens.length})</span>
        </h2>
        {itens.length === 0 && <p className="text-sm text-gray-500">Nenhuma pergunta cadastrada.</p>}

        {itens.map((item) => (
          <div key={item.id} className={`border border-gray-800 rounded p-4 space-y-2 ${item.ativo ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-white">{item.pergunta}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => atualizar(item.id, { ativo: !item.ativo })}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  {item.ativo ? "desativar" : "ativar"}
                </button>
                {isAdmin && (
                  <button onClick={() => remover(item.id)} className="text-xs text-gray-500 hover:text-red-400">
                    remover
                  </button>
                )}
              </div>
            </div>
            <textarea
              defaultValue={item.resposta}
              rows={2}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== item.resposta) {
                  atualizar(item.id, { resposta: e.target.value });
                }
              }}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            />
            <p className="text-[11px] text-gray-500">
              {item.artista ?? "todos os artistas"} · ordem {item.ordem}
              {!item.ativo && " · inativa (não aparece na central)"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
