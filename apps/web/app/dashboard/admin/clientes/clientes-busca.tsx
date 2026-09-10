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

  const [novoTelefone, setNovoTelefone] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [consentiu, setConsentiu] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setCadastrando(true);
    try {
      const res = await fetch("/api/clientes/cadastrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: novoTelefone, nome: novoNome, email: novoEmail, consentiu,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao cadastrar");
      setNovoTelefone(""); setNovoNome(""); setNovoEmail(""); setConsentiu(false);
      setResultados([json]);
      toast.success("Cliente cadastrado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar");
    } finally {
      setCadastrando(false);
    }
  }

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
    <div className="space-y-8">
      <form onSubmit={cadastrar} className="border border-gray-800 rounded p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Cadastrar cliente</h2>
        <p className="text-xs text-gray-500">
          O telefone é normalizado automaticamente — digitar
          &quot;(41) 99999-9999&quot; ou &quot;5541999999999&quot; grava a mesma pessoa.
          Se já existir cadastro com esse número, os campos preenchidos aqui
          completam o que faltava.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-400 space-y-1">
            <span>Telefone</span>
            <input value={novoTelefone} onChange={(e) => setNovoTelefone(e.target.value)}
              placeholder="(41) 99999-9999"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400 space-y-1">
            <span>Nome</span>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400 space-y-1">
            <span>E-mail</span>
            <input value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
        </div>
        <label className="flex items-start gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={consentiu} onChange={(e) => setConsentiu(e.target.checked)}
            className="mt-0.5" />
          <span>
            A pessoa autorizou o uso dos dados para contato sobre shows.
            <span className="block text-gray-600">
              Sem marcar, o cadastro entra sem registro de consentimento — melhor isso
              do que registrar um aceite que não houve.
            </span>
          </span>
        </label>
        <button type="submit" disabled={cadastrando || !novoTelefone.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5">
          {cadastrando ? "Cadastrando…" : "Cadastrar"}
        </button>
      </form>

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
