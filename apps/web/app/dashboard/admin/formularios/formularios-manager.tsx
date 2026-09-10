"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Formulario {
  id: string;
  slug: string;
  nome: string;
  artista: string | null;
  titulo: string;
  descricao: string | null;
  texto_consentimento: string;
  versao_consentimento: string;
  mensagem_sucesso: string;
  whatsapp_numero: string | null;
  whatsapp_mensagem: string | null;
  exige_nome: boolean;
  exige_email: boolean;
  dominios_permitidos: string[];
  ativo: boolean;
  created_at: string;
}

const CONSENTIMENTO_PADRAO =
  "Autorizo o contato pelo WhatsApp sobre shows e novidades. Meus dados serão usados só para isso e posso pedir a remoção quando quiser.";

export default function FormulariosManager({
  initial,
  artistas,
  origem,
}: {
  initial: Formulario[];
  artistas: string[];
  origem: string;
}) {
  const [formularios, setFormularios] = useState(initial);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [artista, setArtista] = useState("");
  const [texto, setTexto] = useState(CONSENTIMENTO_PADRAO);
  const [criando, setCriando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    try {
      const res = await fetch("/api/formularios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, slug, artista: artista || null, textoConsentimento: texto }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao criar");
      setFormularios((fs) => [json, ...fs]);
      setNome(""); setSlug("");
      toast.success("Formulário criado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar formulário");
    } finally {
      setCriando(false);
    }
  }

  async function atualizar(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/formularios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao salvar");
      return;
    }
    setFormularios((fs) => fs.map((f) => (f.id === id ? json : f)));
  }

  async function remover(id: string) {
    if (!confirm("Remover este formulário? Quem tiver o embed no site vai ver uma página indisponível.")) return;
    const res = await fetch(`/api/formularios/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Falha ao remover");
      return;
    }
    setFormularios((fs) => fs.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-8">
      <form onSubmit={criar} className="border border-gray-800 rounded p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Novo formulário</h2>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-400 space-y-1">
            <span>Nome interno</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Landing turnê 2026"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400 space-y-1">
            <span>Endereço (slug)</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="turne-2026"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-400 space-y-1">
            <span>Artista</span>
            <select value={artista} onChange={(e) => setArtista(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white">
              <option value="">Nenhum específico</option>
              {artistas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <label className="text-xs text-gray-400 space-y-1 block">
          <span>Texto de consentimento (o que a pessoa aceita ao marcar a caixa)</span>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
        </label>
        <button type="submit" disabled={criando || !nome.trim() || !slug.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5">
          {criando ? "Criando…" : "Criar formulário"}
        </button>
      </form>

      {formularios.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum formulário criado ainda.</p>
      )}

      {formularios.map((f) => (
        <Cartao key={f.id} form={f} origem={origem}
          onAtualizar={(patch) => atualizar(f.id, patch)} onRemover={() => remover(f.id)} />
      ))}
    </div>
  );
}

function Cartao({
  form,
  origem,
  onAtualizar,
  onRemover,
}: {
  form: Formulario;
  origem: string;
  onAtualizar: (patch: Record<string, unknown>) => void;
  onRemover: () => void;
}) {
  const [dominios, setDominios] = useState(form.dominios_permitidos.join(", "));
  const [waNumero, setWaNumero] = useState(form.whatsapp_numero ?? "");
  const [waMensagem, setWaMensagem] = useState(form.whatsapp_mensagem ?? "");
  const url = `${origem}/f/${form.slug}`;
  const embed = `<iframe src="${url}" style="width:100%;max-width:480px;height:520px;border:0" title="${form.titulo}"></iframe>`;

  function copiar(texto: string, oque: string) {
    navigator.clipboard.writeText(texto);
    toast.success(`${oque} copiado`);
  }

  return (
    <div className={`border border-gray-800 rounded p-4 space-y-3 ${form.ativo ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{form.nome}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
              form.ativo ? "text-green-400 border-green-800" : "text-gray-400 border-gray-700"
            }`}>
              {form.ativo ? "Ativo" : "Desligado"}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            /f/{form.slug}
            {form.artista ? ` · ${form.artista}` : ""} · consentimento {form.versao_consentimento}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onAtualizar({ ativo: !form.ativo })}
            className="text-xs text-gray-400 hover:text-white">
            {form.ativo ? "desligar" : "ligar"}
          </button>
          <button onClick={onRemover} className="text-xs text-gray-500 hover:text-red-400">remover</button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11px] bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-gray-300 truncate">
            {embed}
          </code>
          <button onClick={() => copiar(embed, "Embed")}
            className="text-xs text-blue-400 hover:underline shrink-0">copiar embed</button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11px] bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-gray-300 truncate">
            POST {origem}/api/public/cadastro/{form.slug}
          </code>
          <button onClick={() => copiar(`${origem}/api/public/cadastro/${form.slug}`, "Endpoint")}
            className="text-xs text-blue-400 hover:underline shrink-0">copiar endpoint</button>
        </div>
        <p className="text-[11px] text-gray-500">
          O endpoint aceita <code>{"{ nome, email, telefone, consentiu: true }"}</code> — use se preferir
          montar o formulário no seu próprio site.
        </p>
      </div>

      <div className="space-y-2 border-t border-gray-800 pt-3">
        <p className="text-xs text-gray-400">Depois de cadastrar, abrir conversa em:</p>
        <div className="flex flex-wrap gap-2">
          <input value={waNumero} onChange={(e) => setWaNumero(e.target.value)}
            onBlur={() => {
              if (waNumero !== (form.whatsapp_numero ?? "")) onAtualizar({ whatsappNumero: waNumero });
            }}
            placeholder="+55 41 8440-8675"
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white w-44" />
          <input value={waMensagem} onChange={(e) => setWaMensagem(e.target.value)}
            onBlur={() => {
              if (waMensagem !== (form.whatsapp_mensagem ?? "")) onAtualizar({ whatsappMensagem: waMensagem });
            }}
            placeholder="menu"
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white flex-1 min-w-[10rem]" />
        </div>
        <p className="text-[11px] text-gray-500">
          Sem número, a tela de sucesso não mostra botão nenhum. O texto vai preenchido na
          conversa e precisa bater com uma palavra-chave da automação desse número — hoje
          &quot;menu&quot; abre a central.
        </p>
      </div>

      <label className="text-xs text-gray-400 space-y-1 block">
        <span>Domínios permitidos (vazio = qualquer origem)</span>
        <input value={dominios} onChange={(e) => setDominios(e.target.value)}
          onBlur={() => {
            const lista = dominios.split(",").map((d) => d.trim()).filter(Boolean);
            if (lista.join(",") !== form.dominios_permitidos.join(",")) {
              onAtualizar({ dominiosPermitidos: lista });
            }
          }}
          placeholder="plauz.com.br, www.plauz.com.br"
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
      </label>

      <p className="text-[11px] text-gray-500">
        Trocar o texto de consentimento exige informar uma versão nova — sem isso, quem
        aceitou o texto anterior apareceria como tendo aceitado este.
      </p>
    </div>
  );
}
