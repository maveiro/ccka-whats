"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Numero {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  label: string | null;
  artista: string | null;
  active: boolean;
  created_at: string;
}

export default function NumbersManager({
  initial,
  flowsAtivosPorNumero,
}: {
  initial: Numero[];
  flowsAtivosPorNumero: Record<string, number>;
}) {
  const [numeros, setNumeros] = useState(initial);
  const [mostrarForm, setMostrarForm] = useState(initial.length === 0);
  const [salvando, setSalvando] = useState(false);

  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [label, setLabel] = useState("");
  const [artista, setArtista] = useState("");

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const res = await fetch("/api/campaigns/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wabaId, phoneNumberId, displayPhoneNumber, accessToken, label, artista }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao cadastrar");

      setNumeros((ns) => {
        const semDuplicata = ns.filter((n) => n.id !== json.id);
        return [...semDuplicata, json];
      });
      setWabaId(""); setPhoneNumberId(""); setDisplayPhoneNumber("");
      setAccessToken(""); setLabel(""); setArtista("");
      setMostrarForm(false);
      toast.success("Número cadastrado e conectado à caixa de entrada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar número");
    } finally {
      setSalvando(false);
    }
  }

  async function atualizar(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/campaigns/credentials/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao salvar");
      return false;
    }
    setNumeros((ns) => ns.map((n) => (n.id === id ? { ...n, ...json } : n)));
    return true;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {numeros.length === 0 && !mostrarForm && (
          <p className="text-sm text-gray-500">Nenhum número cadastrado.</p>
        )}

        {numeros.map((n) => (
          <NumeroCard
            key={n.id}
            numero={n}
            flowsAtivos={flowsAtivosPorNumero[n.id] ?? 0}
            onAtualizar={(patch) => atualizar(n.id, patch)}
          />
        ))}
      </div>

      {!mostrarForm && (
        <button
          onClick={() => setMostrarForm(true)}
          className="text-sm text-blue-400 hover:underline"
        >
          + Cadastrar outro número
        </button>
      )}

      {mostrarForm && (
        <form onSubmit={cadastrar} className="border border-gray-800 rounded p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Cadastrar número</h2>
          <p className="text-xs text-gray-500">
            Dados do WhatsApp Business Account (WABA) no Meta Business Manager. O token é
            verificado na Graph API antes de salvar e nunca é reexibido depois.
            Cadastrar um número não mexe nos demais.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="WABA ID" value={wabaId} onChange={setWabaId} />
            <Campo label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} />
            <Campo label="Número exibido (opcional)" value={displayPhoneNumber} onChange={setDisplayPhoneNumber} />
            <Campo label="Nome amigável (opcional)" value={label} onChange={setLabel} placeholder="Ex: Comercial — turnê 2026" />
            <Campo label="Artista (opcional)" value={artista} onChange={setArtista} />
            <Campo label="Access Token (permanente)" value={accessToken} onChange={setAccessToken} type="password" />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={salvando || !wabaId || !phoneNumberId || !accessToken}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5"
            >
              {salvando ? "Verificando…" : "Cadastrar"}
            </button>
            {numeros.length > 0 && (
              <button
                type="button"
                onClick={() => setMostrarForm(false)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function NumeroCard({
  numero,
  flowsAtivos,
  onAtualizar,
}: {
  numero: Numero;
  flowsAtivos: number;
  onAtualizar: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(numero.label ?? "");
  const [artista, setArtista] = useState(numero.artista ?? "");

  return (
    <div className="border border-gray-800 rounded p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {numero.label || numero.display_phone_number || numero.phone_number_id}
            </span>
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded border ${
                numero.active ? "text-green-400 border-green-800" : "text-gray-400 border-gray-700"
              }`}
            >
              {numero.active ? "Ativo" : "Inativo"}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {numero.display_phone_number ?? "—"} · ID {numero.phone_number_id}
            {flowsAtivos > 0 && ` · ${flowsAtivos} automação ativa`}
          </p>
        </div>

        <button
          onClick={() => onAtualizar({ active: !numero.active })}
          className="text-xs rounded px-2 py-1 border border-gray-700 text-gray-300 hover:bg-gray-800 shrink-0"
        >
          {numero.active ? "Desativar" : "Reativar"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-400 space-y-1">
          <span>Nome amigável</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => { if (label !== (numero.label ?? "")) onAtualizar({ label }); }}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            placeholder={numero.display_phone_number ?? numero.phone_number_id}
          />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>Artista</span>
          <input
            value={artista}
            onChange={(e) => setArtista(e.target.value)}
            onBlur={() => { if (artista !== (numero.artista ?? "")) onAtualizar({ artista }); }}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          />
        </label>
      </div>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-xs text-gray-400 space-y-1 block">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
      />
    </label>
  );
}
