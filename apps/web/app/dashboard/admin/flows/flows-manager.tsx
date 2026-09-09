"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Keyword {
  id: string;
  palavra_chave: string;
  tipo_resposta: string;
  resposta: string | null;
  flow_destino_id: string | null;
}

interface Destino {
  id: string;
  nome: string;
  tipo: string;
  cloud_credential_id: string;
}

interface Flow {
  id: string;
  cloud_credential_id: string;
  artista: string | null;
  nome: string;
  tipo: string;
  ativo: boolean;
  meta_flow_id: string | null;
  mensagem_boas_vindas: string | null;
  mensagem_fallback: string | null;
  created_at: string;
  flow_palavras_chave: Keyword[];
}

interface Credencial {
  id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  label: string | null;
  artista: string | null;
}

interface Fallback {
  id: string;
  createdAt: string;
  texto: string;
  telefone: string | null;
  chatId: string | null;
}

export default function FlowsManager({
  initial,
  credenciais,
  isAdmin,
  destinos,
}: {
  initial: Flow[];
  credenciais: Credencial[];
  isAdmin: boolean;
  destinos: Destino[];
}) {
  const [flows, setFlows] = useState<Flow[]>(initial);
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoNumero, setNovoNumero] = useState(credenciais[0]?.id ?? "");
  // Herda o artista do número escolhido — na prática um número é de um
  // artista, e redigitar em todo Flow é fonte de divergência.
  const [novoArtista, setNovoArtista] = useState(credenciais[0]?.artista ?? "");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const nomeDoNumero = (credencialId: string) => {
    const c = credenciais.find((x) => x.id === credencialId);
    return c?.label ?? c?.display_phone_number ?? c?.phone_number_id ?? "número desconhecido";
  };

  async function criarFlow(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim() || !novoNumero) return;
    setCriando(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudCredentialId: novoNumero,
          nome: novoNome,
          artista: novoArtista,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao criar Flow");
      setFlows((f) => [json, ...f]);
      setNovoNome("");
      setNovoArtista("");
      setExpandido(json.id);
      toast.success("Flow criado. Cadastre as palavras-chave e o fallback para poder ativar.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar Flow");
    } finally {
      setCriando(false);
    }
  }

  async function atualizarFlow(id: string, patch: Record<string, unknown>) {
    setSalvando(id);
    try {
      const res = await fetch(`/api/flows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, ...json } : f)));
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      return false;
    } finally {
      setSalvando(null);
    }
  }

  async function excluirFlow(id: string) {
    if (!confirm("Excluir este Flow? As palavras-chave vão junto. O histórico de conversas é preservado.")) return;
    const res = await fetch(`/api/flows/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao excluir");
      return;
    }
    setFlows((fs) => fs.filter((f) => f.id !== id));
    toast.success("Flow excluído");
  }

  if (credenciais.length === 0) {
    return (
      <p className="text-sm text-gray-400 border border-gray-800 rounded p-4">
        Nenhum número WhatsApp Cloud API cadastrado neste tenant. Cadastre um em{" "}
        <a href="/dashboard/admin/numbers" className="text-blue-400 hover:underline">Números</a>{" "}
        antes de criar uma automação.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <form onSubmit={criarFlow} className="border border-gray-800 rounded p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Novo Flow</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400 space-y-1">
            <span>Número</span>
            <select
              value={novoNumero}
              onChange={(e) => {
                setNovoNumero(e.target.value);
                const c = credenciais.find((x) => x.id === e.target.value);
                if (c?.artista) setNovoArtista(c.artista);
              }}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            >
              {credenciais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? c.display_phone_number ?? c.phone_number_id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400 space-y-1">
            <span>Artista (opcional)</span>
            <input
              value={novoArtista}
              onChange={(e) => setNovoArtista(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              placeholder="Ex: Prof. Marli"
            />
          </label>
        </div>
        <label className="text-xs text-gray-400 space-y-1 block">
          <span>Nome do Flow</span>
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            placeholder="Ex: FAQ da turnê 2026"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={criando || !novoNome.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5"
          >
            {criando ? "Criando…" : "Criar Flow"}
          </button>
          <span className="text-xs text-gray-500">
            Nasce inativo — só responde depois que você ativar.
          </span>
        </div>
      </form>

      <div className="space-y-4">
        {flows.length === 0 && (
          <p className="text-sm text-gray-500">Nenhuma automação criada ainda.</p>
        )}

        {flows.map((flow) => (
          <FlowCard
            key={flow.id}
            flow={flow}
            numero={nomeDoNumero(flow.cloud_credential_id)}
            isAdmin={isAdmin}
            expandido={expandido === flow.id}
            onToggleExpandir={() => setExpandido(expandido === flow.id ? null : flow.id)}
            salvando={salvando === flow.id}
            destinos={destinos.filter((d) => d.cloud_credential_id === flow.cloud_credential_id && d.id !== flow.id)}
            onAtualizar={(patch) => atualizarFlow(flow.id, patch)}
            onExcluir={() => excluirFlow(flow.id)}
            onKeywordsMudaram={(keywords) =>
              setFlows((fs) => fs.map((f) => (f.id === flow.id ? { ...f, flow_palavras_chave: keywords } : f)))
            }
          />
        ))}
      </div>
    </div>
  );
}

function FlowCard({
  flow,
  numero,
  isAdmin,
  destinos,
  expandido,
  onToggleExpandir,
  salvando,
  onAtualizar,
  onExcluir,
  onKeywordsMudaram,
}: {
  flow: Flow;
  numero: string;
  isAdmin: boolean;
  destinos: Destino[];
  expandido: boolean;
  onToggleExpandir: () => void;
  salvando: boolean;
  onAtualizar: (patch: Record<string, unknown>) => Promise<boolean>;
  onExcluir: () => void;
  onKeywordsMudaram: (keywords: Keyword[]) => void;
}) {
  const [boasVindas, setBoasVindas] = useState(flow.mensagem_boas_vindas ?? "");
  const [fallback, setFallback] = useState(flow.mensagem_fallback ?? "");
  const [novaPalavra, setNovaPalavra] = useState("");
  const [novaResposta, setNovaResposta] = useState("");
  const [novoTipo, setNovoTipo] = useState("texto");
  const [novoDestino, setNovoDestino] = useState(destinos[0]?.id ?? "");
  const [addLoading, setAddLoading] = useState(false);
  const [fallbacks, setFallbacks] = useState<Fallback[] | null>(null);
  const [fallbacksLoading, setFallbacksLoading] = useState(false);

  const keywords = flow.flow_palavras_chave;

  async function carregarFallbacks() {
    setFallbacksLoading(true);
    try {
      const res = await fetch(`/api/flows/${flow.id}/fallbacks?limit=20`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar");
      setFallbacks(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar fallbacks");
    } finally {
      setFallbacksLoading(false);
    }
  }

  async function adicionarKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!novaPalavra.trim()) return;
    if (novoTipo === "abrir_flow" ? !novoDestino : !novaResposta.trim()) return;
    setAddLoading(true);
    try {
      const res = await fetch(`/api/flows/${flow.id}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          palavraChave: novaPalavra,
          tipoResposta: novoTipo,
          resposta: novoTipo === "abrir_flow" ? "" : novaResposta,
          flowDestinoId: novoTipo === "abrir_flow" ? novoDestino : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao adicionar");
      onKeywordsMudaram([...keywords, json]);
      setNovaPalavra("");
      setNovaResposta("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar palavra-chave");
    } finally {
      setAddLoading(false);
    }
  }

  async function removerKeyword(id: string) {
    const res = await fetch(`/api/flows/keywords/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao remover");
      return;
    }
    onKeywordsMudaram(keywords.filter((k) => k.id !== id));
  }

  return (
    <div className="border border-gray-800 rounded">
      <div className="flex items-center justify-between p-4">
        <button onClick={onToggleExpandir} className="text-left flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{flow.nome}</span>
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded border ${
                flow.ativo ? "text-green-400 border-green-800" : "text-gray-400 border-gray-700"
              }`}
            >
              {flow.ativo ? "Ativo" : "Inativo"}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {numero}
            {flow.artista ? ` · ${flow.artista}` : ""} · {keywords.length}{" "}
            {keywords.length === 1 ? "palavra-chave" : "palavras-chave"}
          </p>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onAtualizar({ ativo: !flow.ativo })}
            disabled={salvando}
            className={`text-xs rounded px-2 py-1 border ${
              flow.ativo
                ? "border-gray-700 text-gray-300 hover:bg-gray-800"
                : "border-green-800 text-green-400 hover:bg-green-950"
            }`}
          >
            {flow.ativo ? "Desativar" : "Ativar"}
          </button>
          {isAdmin && (
            <button
              onClick={onExcluir}
              className="text-xs text-red-400 border border-red-900 rounded px-2 py-1 hover:bg-red-950"
            >
              Excluir
            </button>
          )}
        </div>
      </div>

      {expandido && (
        <div className="border-t border-gray-800 p-4 space-y-5">
          <div className="space-y-3">
            <label className="text-xs text-gray-400 space-y-1 block">
              <span>Mensagem de boas-vindas (primeiro contato, e depois de 14 dias sem falar)</span>
              <textarea
                value={boasVindas}
                onChange={(e) => setBoasVindas(e.target.value)}
                onBlur={() => {
                  if (boasVindas !== (flow.mensagem_boas_vindas ?? "")) {
                    onAtualizar({ mensagemBoasVindas: boasVindas });
                  }
                }}
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
                placeholder="Deixe em branco para não mandar boas-vindas"
              />
            </label>

            <label className="text-xs text-gray-400 space-y-1 block">
              <span>Mensagem de fallback (quando nenhuma palavra-chave bate)</span>
              <textarea
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                onBlur={() => {
                  if (fallback !== (flow.mensagem_fallback ?? "")) {
                    onAtualizar({ mensagemFallback: fallback });
                  }
                }}
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              />
            </label>
            <p className="text-[11px] text-gray-500">
              Depois de 3 fallbacks seguidos, a automação se cala sozinha e registra um
              alerta — para não repetir a mesma resposta genérica indefinidamente.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-300">Palavras-chave</h3>

            {keywords.length === 0 && (
              <p className="text-xs text-gray-500">
                Nenhuma ainda — é preciso ao menos uma para ativar o Flow.
              </p>
            )}

            <ul className="space-y-1">
              {keywords.map((k) => (
                <li
                  key={k.id}
                  className="flex items-start justify-between gap-3 text-sm bg-gray-900/50 rounded px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-white">{k.palavra_chave}</span>
                    <span className="text-gray-500 text-xs"> → </span>
                    <span className="text-gray-300 text-xs break-words">
                      {k.tipo_resposta === "abrir_flow"
                        ? `abre: ${destinos.find((d) => d.id === k.flow_destino_id)?.nome ?? "Flow"}`
                        : k.resposta}
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => removerKeyword(k.id)}
                      className="text-xs text-gray-500 hover:text-red-400 shrink-0"
                    >
                      remover
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <form onSubmit={adicionarKeyword} className="flex flex-wrap gap-2 pt-1">
              <input
                value={novaPalavra}
                onChange={(e) => setNovaPalavra(e.target.value)}
                placeholder="palavra-chave"
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white w-40"
              />
              <select
                value={novoTipo}
                onChange={(e) => setNovoTipo(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="texto">Texto</option>
                <option value="link">Link</option>
                <option value="abrir_flow" disabled={destinos.length === 0}>
                  {destinos.length === 0 ? "Abrir Flow (nenhum publicado)" : "Abrir Flow"}
                </option>
              </select>
              {novoTipo === "abrir_flow" ? (
                <select
                  value={novoDestino}
                  onChange={(e) => setNovoDestino(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white flex-1 min-w-[12rem]"
                >
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>{d.nome} ({d.tipo})</option>
                  ))}
                </select>
              ) : (
                <input
                  value={novaResposta}
                  onChange={(e) => setNovaResposta(e.target.value)}
                  placeholder="resposta"
                  className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white flex-1 min-w-[12rem]"
                />
              )}
              <button
                type="submit"
                disabled={addLoading}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5"
              >
                Adicionar
              </button>
            </form>
            <p className="text-[11px] text-gray-500">
              O match ignora acento, maiúscula e plural, e casa palavra inteira. Quando
              duas keywords batem, vence a mais específica (mais palavras).
            </p>
          </div>

          <div className="space-y-2 border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-300">
                Caiu em fallback recentemente
              </h3>
              <button
                onClick={carregarFallbacks}
                disabled={fallbacksLoading}
                className="text-xs text-blue-400 hover:underline disabled:opacity-40"
              >
                {fallbacksLoading ? "Carregando…" : fallbacks ? "Atualizar" : "Ver"}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">
              Cada linha é alguém que perguntou algo que nenhuma palavra-chave cobre.
              Clique em &quot;usar&quot; para começar uma keyword com esse texto.
            </p>

            {fallbacks && fallbacks.length === 0 && (
              <p className="text-xs text-gray-500">Nada em fallback por enquanto.</p>
            )}

            {fallbacks && fallbacks.length > 0 && (
              <ul className="space-y-1">
                {fallbacks.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 text-sm bg-gray-900/50 rounded px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-gray-200 break-words">{f.texto || "(sem texto)"}</p>
                      <p className="text-[11px] text-gray-500">
                        {new Date(f.createdAt).toLocaleString("pt-BR")}
                        {f.chatId && (
                          <>
                            {" · "}
                            <a href={`/dashboard/chat/${f.chatId}`} className="text-blue-400 hover:underline">
                              abrir conversa
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setNovaPalavra(f.texto.split(/\s+/).slice(0, 3).join(" "))}
                      className="text-xs text-gray-500 hover:text-blue-400 shrink-0"
                    >
                      usar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
