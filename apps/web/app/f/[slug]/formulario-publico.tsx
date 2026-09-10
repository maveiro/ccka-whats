"use client";

import { useState } from "react";

export default function FormularioPublico({
  slug,
  textoConsentimento,
  mensagemSucesso,
  exigeNome,
  exigeEmail,
}: {
  slug: string;
  textoConsentimento: string;
  mensagemSucesso: string;
  exigeNome: boolean;
  exigeEmail: boolean;
}) {
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [consentiu, setConsentiu] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch(`/api/public/cadastro/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, nome, email, consentiu, website }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível concluir agora");
      setPronto(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível concluir agora");
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className="mt-6 border border-green-900 bg-green-950/40 rounded p-4">
        <p className="text-sm text-green-300">{mensagemSucesso}</p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mt-6 space-y-3">
      {/* Honeypot: escondido de gente, visível para bot. Não usa display:none
          porque alguns bots ignoram campos ocultos por CSS óbvio. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        <label>
          Não preencha este campo
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {exigeNome && (
        <label className="block text-xs text-gray-400 space-y-1">
          <span>Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} required
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white" />
        </label>
      )}

      <label className="block text-xs text-gray-400 space-y-1">
        <span>WhatsApp (com DDD)</span>
        <input value={telefone} onChange={(e) => setTelefone(e.target.value)} required
          inputMode="tel" placeholder="(41) 99999-9999"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white" />
      </label>

      {exigeEmail && (
        <label className="block text-xs text-gray-400 space-y-1">
          <span>E-mail</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white" />
        </label>
      )}

      <label className="flex items-start gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={consentiu} onChange={(e) => setConsentiu(e.target.checked)}
          required className="mt-0.5" />
        <span>{textoConsentimento}</span>
      </label>

      {erro && <p className="text-xs text-red-400">{erro}</p>}

      <button type="submit" disabled={enviando}
        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded px-3 py-2">
        {enviando ? "Enviando…" : "Quero receber novidades"}
      </button>
    </form>
  );
}
