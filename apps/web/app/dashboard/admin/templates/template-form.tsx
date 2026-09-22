"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { placeholders, variavelNaBordaDoCorpo } from "@/lib/whatsapp-cloud/templateComponents";

interface Credential {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  artista: string | null;
  active: boolean;
}

// Flow abrível numa conversa, do mesmo número — mesma forma de
// campaign-wizard.tsx (regra 37: template é aprovado na WABA, mas o botão
// de Flow só faz sentido para o número dono daquele Flow).
interface Flow {
  id: string;
  cloud_credential_id: string;
  nome: string;
  artista: string | null;
  tipo: string;
  ativo: boolean;
  meta_flow_id: string | null;
}

const LIMITE_HEADER = 60;
const LIMITE_BODY = 1024;
const LIMITE_FOOTER = 60;

export default function TemplateForm({
  credentials,
  credentialId,
  onCredentialChange,
  linkBaseUrl,
  onCriado,
}: {
  credentials: Credential[];
  credentialId: string | null;
  onCredentialChange: (id: string) => void;
  linkBaseUrl: string | null;
  onCriado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [language, setLanguage] = useState("pt_BR");
  const [headerTexto, setHeaderTexto] = useState("");
  const [headerExemplo, setHeaderExemplo] = useState("");
  const [bodyTexto, setBodyTexto] = useState("");
  const [bodyExemplos, setBodyExemplos] = useState<string[]>([]);
  const [footerTexto, setFooterTexto] = useState("");
  const [temBotao, setTemBotao] = useState(false);
  const [botaoModo, setBotaoModo] = useState<"rastreada" | "estatica" | "flow" | "quick_reply">("rastreada");
  const [botaoTexto, setBotaoTexto] = useState("Comprar Meu Ingresso");
  const [botaoUrlEstatica, setBotaoUrlEstatica] = useState("");
  const [botaoFlowId, setBotaoFlowId] = useState("");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomeGerado = useMemo(
    () => titulo.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 512),
    [titulo],
  );

  const headerVars = useMemo(() => placeholders(headerTexto), [headerTexto]);
  const bodyVars = useMemo(() => placeholders(bodyTexto), [bodyTexto]);

  // Só Flow ativo, publicado na Meta, do MESMO número e de tipo abrível numa
  // conversa — mesmo filtro do assistente de campanha.
  const flowsDisponiveis = flows.filter(
    (f) => f.cloud_credential_id === credentialId && f.ativo && f.meta_flow_id &&
      ["central", "agenda_shows"].includes(f.tipo),
  );

  async function carregarFlows() {
    try {
      const res = await fetch("/api/flows");
      if (res.ok) setFlows(await res.json() as Flow[]);
    } catch {
      // Lista vazia já bloqueia a escolha com mensagem própria abaixo.
    }
  }

  function ajustarExemplos(qtd: number) {
    setBodyExemplos((atual) => {
      const novo = atual.slice(0, qtd);
      while (novo.length < qtd) novo.push("");
      return novo;
    });
  }

  function onBodyChange(v: string) {
    setBodyTexto(v);
    ajustarExemplos(placeholders(v).length);
  }

  // Preview da mensagem como o fã vê — troca {{n}} pelo exemplo, pra quem
  // está montando o template julgar antes de submeter, não depois de
  // aprovado (e Flow/template publicado não se edita — regra do CLAUDE.md).
  function preview(texto: string, exemplos: string[]): string {
    return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => exemplos[Number(n) - 1] || `{{${n}}}`);
  }

  const previewBody = preview(bodyTexto, bodyExemplos);
  const previewHeader = preview(headerTexto, [headerExemplo]);
  const urlRastreadaPreview = linkBaseUrl ? `${linkBaseUrl.replace(/\/+$/, "")}/c/{{1}}` : null;

  function resetar() {
    setTitulo(""); setBodyTexto(""); setBodyExemplos([]); setHeaderTexto(""); setHeaderExemplo("");
    setFooterTexto(""); setTemBotao(false); setBotaoModo("rastreada"); setBotaoTexto("Comprar Meu Ingresso");
    setBotaoUrlEstatica(""); setBotaoFlowId(""); setErro(null); setAberto(false);
  }

  async function enviar() {
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId,
          titulo,
          category,
          language,
          headerTexto: headerTexto.trim() || null,
          headerExemplo: headerExemplo.trim() || null,
          bodyTexto,
          bodyExemplos,
          footerTexto: footerTexto.trim() || null,
          botao: temBotao
            ? {
                texto: botaoTexto,
                modo: botaoModo,
                ...(botaoModo === "estatica" ? { urlEstatica: botaoUrlEstatica } : {}),
                ...(botaoModo === "flow" ? { flowId: botaoFlowId } : {}),
              }
            : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      toast.success(`Template enviado para revisão — status: ${json.status}`);
      resetar();
      onCriado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="text-sm px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors"
      >
        + Novo template
      </button>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Novo template</p>
        <button onClick={resetar} className="text-xs text-gray-500 hover:text-white">Cancelar</button>
      </div>

      <div className="space-y-1 bg-gray-800/50 rounded-md px-3 py-2">
        <label className="block text-xs text-gray-400">Conta (WABA)</label>
        <select
          value={credentialId ?? ""}
          onChange={(e) => onCredentialChange(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.artista ? `${c.artista} — ` : ""}{c.display_phone_number || c.phone_number_id}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1">Título (vira o nome do template)</label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Vendas abertas — Natal"
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
          {titulo && <p className="text-[11px] text-gray-500 mt-1 font-mono">name: {nomeGerado || "(precisa de letra ou número)"}</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Idioma</label>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Categoria</label>
        <div className="flex gap-3 text-sm text-gray-300">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={category === "MARKETING"} onChange={() => setCategory("MARKETING")} />
            Marketing
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={category === "UTILITY"} onChange={() => setCategory("UTILITY")} />
            Utility
          </label>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          A Meta pode reclassificar depois de revisar — se o texto tiver tom promocional,
          Utility pode sair aprovado como Marketing, e o preço segue a categoria final.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Cabeçalho (opcional, só texto)</label>
        <input
          value={headerTexto}
          onChange={(e) => setHeaderTexto(e.target.value)}
          maxLength={LIMITE_HEADER}
          placeholder="Olá, {{1}}!"
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
        />
        <p className="text-[11px] text-gray-500 mt-1">{headerTexto.length}/{LIMITE_HEADER} · no máximo 1 variável</p>
        {headerVars.length === 1 && (
          <input
            value={headerExemplo}
            onChange={(e) => setHeaderExemplo(e.target.value)}
            placeholder="Valor de exemplo para {{1}} (ex: Marcelo)"
            className="mt-1.5 w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Corpo</label>
        <textarea
          value={bodyTexto}
          onChange={(e) => onBodyChange(e.target.value)}
          maxLength={LIMITE_BODY}
          rows={4}
          placeholder="O show {{1}} chega em {{2}}. Garanta seu ingresso!"
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
        />
        <p className="text-[11px] text-gray-500 mt-1">{bodyTexto.length}/{LIMITE_BODY}</p>
        {bodyVars.length > 0 && variavelNaBordaDoCorpo(bodyTexto) && (
          <p className="text-[11px] text-amber-400 mt-1">
            A Meta recusa variável logo no início ou no fim do corpo — falta uma palavra
            de verdade antes ou depois dela (pontuação sozinha não conta).
          </p>
        )}
        {bodyVars.map((n) => (
          <input
            key={n}
            value={bodyExemplos[n - 1] ?? ""}
            onChange={(e) => setBodyExemplos((atual) => {
              const novo = [...atual];
              novo[n - 1] = e.target.value;
              return novo;
            })}
            placeholder={`Valor de exemplo para {{${n}}}`}
            className="mt-1.5 w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
        ))}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Rodapé (opcional, sem variável)</label>
        <input
          value={footerTexto}
          onChange={(e) => setFooterTexto(e.target.value)}
          maxLength={LIMITE_FOOTER}
          placeholder="Plauz Produções"
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={temBotao}
            onChange={(e) => {
              setTemBotao(e.target.checked);
              if (e.target.checked && flows.length === 0) void carregarFlows();
            }}
          />
          Botão
        </label>
        {temBotao && (
          <div className="pl-5 space-y-2">
            <input
              value={botaoTexto}
              onChange={(e) => setBotaoTexto(e.target.value)}
              placeholder="Texto do botão"
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
            />

            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={botaoModo === "rastreada"} onChange={() => setBotaoModo("rastreada")} />
                URL rastreada
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={botaoModo === "estatica"} onChange={() => setBotaoModo("estatica")} />
                URL fixa
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={botaoModo === "flow"}
                  onChange={() => { setBotaoModo("flow"); if (flows.length === 0) void carregarFlows(); }}
                />
                Abrir Flow (central)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={botaoModo === "quick_reply"} onChange={() => setBotaoModo("quick_reply")} />
                Resposta rápida
              </label>
            </div>

            {botaoModo === "rastreada" && (
              urlRastreadaPreview ? (
                <p className="text-[11px] text-gray-500 font-mono">{urlRastreadaPreview}</p>
              ) : (
                <p className="text-[11px] text-red-400">
                  NEXT_PUBLIC_LINK_BASE_URL não configurado — não dá para montar a URL rastreada.
                </p>
              )
            )}

            {botaoModo === "estatica" && (
              <input
                value={botaoUrlEstatica}
                onChange={(e) => setBotaoUrlEstatica(e.target.value)}
                placeholder="https://exemplo.com/ingressos"
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
              />
            )}

            {botaoModo === "flow" && (
              flowsDisponiveis.length > 0 ? (
                <select
                  value={botaoFlowId}
                  onChange={(e) => setBotaoFlowId(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
                >
                  <option value="">Escolha o Flow</option>
                  {flowsDisponiveis.map((f) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              ) : (
                <p className="text-[11px] text-amber-400">
                  Nenhum Flow ativo e publicado neste número — crie/publique um em Automações.
                </p>
              )
            )}

            {botaoModo === "quick_reply" && (
              <p className="text-[11px] text-gray-500">
                Sem link — a resposta chega como mensagem, rastreável do mesmo jeito que os
                botões de opt-out.
              </p>
            )}
          </div>
        )}
      </div>

      {bodyTexto.trim() && (
        <div className="bg-gray-800/40 border border-gray-800 rounded-md p-3 space-y-1">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">Como o fã vê</p>
          {headerTexto.trim() && <p className="text-sm text-white font-semibold">{previewHeader}</p>}
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{previewBody}</p>
          {footerTexto.trim() && <p className="text-xs text-gray-500">{footerTexto}</p>}
          {temBotao && botaoTexto.trim() && (
            <p className="text-xs text-green-400 pt-1 border-t border-gray-800 mt-1">↗ {botaoTexto}</p>
          )}
        </div>
      )}

      {erro && <p className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">{erro}</p>}

      <button
        onClick={() => void enviar()}
        disabled={enviando || !titulo.trim() || !bodyTexto.trim() || !credentialId}
        className="w-full text-sm px-3 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-md transition-colors"
      >
        {enviando ? "Enviando..." : "Enviar para revisão"}
      </button>
    </div>
  );
}
