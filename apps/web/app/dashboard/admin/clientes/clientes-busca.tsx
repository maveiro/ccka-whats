"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Cliente {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string;
  origem: string;
  cadastro_completo: boolean;
  pulou_cadastro: boolean;
  pii_apagada_em: string | null;
  created_at: string;
}

export default function ClientesBusca() {
  const [telefone, setTelefone] = useState("");
  const [resultados, setResultados] = useState<Cliente[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setBuscando(true);
    try {
      const res = await fetch(`/api/clientes?telefone=${encodeURIComponent(telefone)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha na busca");
      setResultados(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na busca");
    } finally {
      setBuscando(false);
    }
  }

  async function apagar(cliente: Cliente) {
    const confirmacao = prompt(
      `Apagar DEFINITIVAMENTE nome e e-mail de ${cliente.telefone}?\n\n` +
      `Isto não pode ser desfeito. Digite APAGAR para confirmar.`,
    );
    if (confirmacao !== "APAGAR") return;

    const res = await fetch(`/api/clientes/${cliente.id}/pii`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao apagar");
      return;
    }
    setResultados((rs) =>
      (rs ?? []).map((c) =>
        c.id === cliente.id
          ? { ...c, nome: null, email: null, pii_apagada_em: json.pii_apagada_em ?? new Date().toISOString() }
          : c,
      ),
    );
    toast.success("Dados pessoais apagados");
  }

  return (
    <div className="space-y-5">
      <form onSubmit={buscar} className="flex gap-2">
        <input
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="telefone (ao menos 8 dígitos)"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white"
        />
        <button
          type="submit"
          disabled={buscando}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-4 py-2"
        >
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {resultados?.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum cliente com esse telefone.</p>
      )}

      {(resultados ?? []).map((c) => (
        <div key={c.id} className="border border-gray-800 rounded p-4 flex items-start justify-between gap-4">
          <div className="min-w-0 text-sm">
            <p className="text-white">{c.nome ?? <span className="text-gray-500 italic">sem nome</span>}</p>
            <p className="text-gray-400">{c.email ?? <span className="text-gray-500 italic">sem e-mail</span>}</p>
            <p className="text-xs text-gray-500 mt-1">
              {c.telefone} · origem {c.origem}
              {c.pulou_cadastro && " · pulou cadastro"}
              {c.pii_apagada_em && ` · dados apagados em ${new Date(c.pii_apagada_em).toLocaleDateString("pt-BR")}`}
            </p>
          </div>
          {!c.pii_apagada_em && (
            <button
              onClick={() => apagar(c)}
              className="text-xs text-red-400 border border-red-900 rounded px-2 py-1 hover:bg-red-950 shrink-0"
            >
              Apagar dados pessoais
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
