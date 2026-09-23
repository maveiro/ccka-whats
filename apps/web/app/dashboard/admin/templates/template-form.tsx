"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import Button from "@/components/ui/button";
import {
  formularioAPartirDeComponentes,
  placeholders,
  variavelNaBordaDoCorpo,
  type FormatoMidia,
} from "@/lib/whatsapp-cloud/templateComponents";

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

/** Template existente cuja edição está em andamento — só REJECTED aceita (achado ao vivo, 22/09/2026). */
export interface TemplateParaEditar {
  id: string;
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

const LIMITE_HEADER = 60;
const LIMITE_BODY = 1024;
const LIMITE_FOOTER = 60;

type BotaoModo = "rastreada" | "estatica" | "flow" | "quick_reply";
type HeaderTipo = "nenhum" | "texto" | "midia";

export default function TemplateForm({
  credentials,
  credentialId,
  onCredentialChange,
  linkBaseUrl,
  onCriado,
  templateParaEditar,
  onEditado,
  onFecharEdicao,
}: {
  credentials: Credential[];
  credentialId: string | null;
  onCredentialChange: (id: string) => void;
  linkBaseUrl: string | null;
  onCriado: () => void;
  /** Presente = formulário abre em modo EDIÇÃO, pré-preenchido. */
  templateParaEditar?: TemplateParaEditar | null;
  onEditado?: () => void;
  onFecharEdicao?: () => void;
}) {
  const editando = templateParaEditar ?? null;
  const parsed = useMemo(
    () => (editando ? formularioAPartirDeComponentes(editando.components) : null),
    [editando],
  );

  const [aberto, setAberto] = useState(Boolean(editando));
  const [titulo, setTitulo] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">(
    (editando?.category.toUpperCase() as "MARKETING" | "UTILITY") ?? "MARKETING",
  );
  const [language] = useState(editando?.language ?? "pt_BR");

  const [headerTipo, setHeaderTipo] = useState<HeaderTipo>(
    parsed?.headerMidiaFormato ? "midia" : parsed?.headerTexto ? "texto" : "nenhum",
  );
  const [headerTexto, setHeaderTexto] = useState(parsed?.headerTexto ?? "");
  const [headerExemplo, setHeaderExemplo] = useState(parsed?.headerExemplo ?? "");
  const [headerMidiaFormatoOriginal] = useState<FormatoMidia | null>(parsed?.headerMidiaFormato ?? null);
  const [headerMidiaFormato, setHeaderMidiaFormato] = useState<FormatoMidia>(parsed?.headerMidiaFormato ?? "IMAGE");
  const [headerMidiaHandle, setHeaderMidiaHandle] = useState<string | null>(null);
  const [headerMidiaNome, setHeaderMidiaNome] = useState<string | null>(null);
  const [enviandoMidia, setEnviandoMidia] = useState(false);

  const [bodyTexto, setBodyTexto] = useState(parsed?.bodyTexto ?? "");
  const [bodyExemplos, setBodyExemplos] = useState<string[]>(parsed?.bodyExemplos ?? []);
  const [footerTexto, setFooterTexto] = useState(parsed?.footerTexto ?? "");

  const [temBotao, setTemBotao] = useState(Boolean(parsed?.botao));
  const [botaoModo, setBotaoModo] = useState<BotaoModo>(parsed?.botao?.modo ?? "rastreada");
  const [botaoTexto, setBotaoTexto] = useState(parsed?.botao?.texto || "Comprar Meu Ingresso");
  const [botaoUrlEstatica, setBotaoUrlEstatica] = useState(parsed?.botao?.urlEstatica ?? "");
  const [botaoFlowId, setBotaoFlowId] = useState("");
  // Flow existente que o botão abria (edição), antes de casar com a lista
  // carregada — mostrado como dica até a pessoa escolher de novo.
  const [botaoFlowMetaIdOriginal] = useState<string | null>(parsed?.botao?.flowMetaId ?? null);
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

  async function subirMidia(file: File) {
    if (!credentialId) return;
    setEnviandoMidia(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("credentialId", credentialId);
      form.append("file", file);
      const res = await fetch("/api/templates/upload-header-media", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      setHeaderMidiaHandle(json.handle);
      setHeaderMidiaFormato(json.formato);
      setHeaderMidiaNome(file.name);
      toast.success("Mídia enviada — pronta pra usar no cabeçalho.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviandoMidia(false);
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
    setTitulo(""); setBodyTexto(""); setBodyExemplos([]); setHeaderTipo("nenhum"); setHeaderTexto(""); setHeaderExemplo("");
    setHeaderMidiaHandle(null); setHeaderMidiaNome(null);
    setFooterTexto(""); setTemBotao(false); setBotaoModo("rastreada"); setBotaoTexto("Comprar Meu Ingresso");
    setBotaoUrlEstatica(""); setBotaoFlowId(""); setErro(null); setAberto(false);
    onFecharEdicao?.();
  }

  // Falta subir mídia nova quando o cabeçalho é de mídia — handle antigo (se
  // havia, na edição) não é reaproveitável, então SEMPRE exige upload novo.
  const faltaMidia = headerTipo === "midia" && !headerMidiaHandle;

  function montarPayloadBotao() {
    if (!temBotao) return null;
    return {
      texto: botaoTexto,
      modo: botaoModo,
      ...(botaoModo === "estatica" ? { urlEstatica: botaoUrlEstatica } : {}),
      ...(botaoModo === "flow" ? { flowId: botaoFlowId } : {}),
    };
  }

  async function enviar() {
    setErro(null);
    if (faltaMidia) {
      setErro("Falta subir o arquivo do cabeçalho.");
      return;
    }
    setEnviando(true);
    try {
      const corpoComum = {
        credentialId,
        category,
        headerTexto: headerTipo === "texto" ? (headerTexto.trim() || null) : null,
        headerExemplo: headerTipo === "texto" ? (headerExemplo.trim() || null) : null,
        headerMidia: headerTipo === "midia" && headerMidiaHandle
          ? { formato: headerMidiaFormato, handle: headerMidiaHandle }
          : null,
        bodyTexto,
        bodyExemplos,
        footerTexto: footerTexto.trim() || null,
        botao: montarPayloadBotao(),
      };

      const res = editando
        ? await fetch("/api/templates/edit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpoComum, templateId: editando.id }),
          })
        : await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpoComum, titulo, language }),
          });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      toast.success(
        editando ? "Template editado e reenviado para revisão." : `Template enviado para revisão — status: ${json.status}`,
      );
      resetar();
      editando ? onEditado?.() : onCriado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <Button variant="primary" size="md" onClick={() => setAberto(true)}>
        + Novo template
      </Button>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 light:bg-white light:border-gray-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white light:text-gray-900">
          {editando ? `Editando "${editando.name}"` : "Novo template"}
        </p>
        <button onClick={resetar} className="text-xs text-gray-400 hover:text-white light:text-gray-600 light:hover:text-gray-900">Cancelar</button>
      </div>

      {editando && (
        <p className="text-[11px] text-amber-400 bg-amber-900/20 border border-amber-900 rounded-md px-3 py-2">
          Só dá para editar um template REJEITADO — a Meta recusa em qualquer outro status.
          Nome e idioma não mudam ({editando.name} · {editando.language}).
        </p>
      )}

      <div className="space-y-1 bg-gray-800/50 rounded-md px-3 py-2 light:bg-gray-100">
        <label className="block text-xs text-gray-400 light:text-gray-600">Conta (WABA)</label>
        <select
          value={credentialId ?? ""}
          onChange={(e) => onCredentialChange(e.target.value)}
          disabled={Boolean(editando)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm disabled:opacity-60 light:bg-white light:border-gray-300 light:text-gray-900"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.artista ? `${c.artista} — ` : ""}{c.display_phone_number || c.phone_number_id}
            </option>
          ))}
        </select>
      </div>

      {!editando && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Título (vira o nome do template)</label>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Vendas abertas — Natal"
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
            />
            {titulo && <p className="text-[11px] text-gray-400 mt-1 font-mono light:text-gray-600">name: {nomeGerado || "(precisa de letra ou número)"}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Idioma</label>
            <input value={language} disabled className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-400 text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-600" />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Categoria</label>
        <div className="flex gap-3 text-sm text-gray-300 light:text-gray-700">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={category === "MARKETING"} onChange={() => setCategory("MARKETING")} />
            Marketing
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={category === "UTILITY"} onChange={() => setCategory("UTILITY")} />
            Utility
          </label>
        </div>
        <p className="text-[11px] text-gray-400 mt-1 light:text-gray-600">
          A Meta pode reclassificar depois de revisar — se o texto tiver tom promocional,
          Utility pode sair aprovado como Marketing, e o preço segue a categoria final.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Cabeçalho (opcional)</label>
        <div className="flex flex-wrap gap-3 text-xs text-gray-400 mb-2 light:text-gray-600">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={headerTipo === "nenhum"} onChange={() => setHeaderTipo("nenhum")} />
            Nenhum
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={headerTipo === "texto"} onChange={() => setHeaderTipo("texto")} />
            Texto
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={headerTipo === "midia"} onChange={() => setHeaderTipo("midia")} />
            Imagem / Vídeo / Documento
          </label>
        </div>

        {headerTipo === "texto" && (
          <>
            <input
              value={headerTexto}
              onChange={(e) => setHeaderTexto(e.target.value)}
              maxLength={LIMITE_HEADER}
              placeholder="Olá, {{1}}!"
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
            />
            <p className="text-[11px] text-gray-400 mt-1 light:text-gray-600">{headerTexto.length}/{LIMITE_HEADER} · no máximo 1 variável</p>
            {headerVars.length === 1 && (
              <input
                value={headerExemplo}
                onChange={(e) => setHeaderExemplo(e.target.value)}
                placeholder="Valor de exemplo para {{1}} (ex: Marcelo)"
                className="mt-1.5 w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
              />
            )}
          </>
        )}

        {headerTipo === "midia" && (
          <div className="space-y-1.5">
            {editando && headerMidiaFormatoOriginal && !headerMidiaHandle && (
              <p className="text-[11px] text-amber-400">
                Este template tinha cabeçalho de {headerMidiaFormatoOriginal.toLowerCase()} — o link antigo
                expirou, suba o arquivo de novo para mantê-lo.
              </p>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,video/mp4,video/3gpp,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirMidia(f); }}
              className="text-xs text-gray-300 light:text-gray-700"
            />
            <p className="text-[11px] text-gray-400 light:text-gray-600">JPEG/PNG até 5MB · MP4/3GPP até 16MB · PDF até 5MB</p>
            {enviandoMidia && <p className="text-[11px] text-gray-400 light:text-gray-600">Enviando…</p>}
            {headerMidiaHandle && (
              <p className="text-[11px] text-green-400 light:text-green-700">✓ {headerMidiaNome} ({headerMidiaFormato.toLowerCase()}) pronto</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Corpo</label>
        <textarea
          value={bodyTexto}
          onChange={(e) => onBodyChange(e.target.value)}
          maxLength={LIMITE_BODY}
          rows={4}
          placeholder="O show {{1}} chega em {{2}}. Garanta seu ingresso!"
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
        />
        <p className="text-[11px] text-gray-400 mt-1 light:text-gray-600">{bodyTexto.length}/{LIMITE_BODY}</p>
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
            className="mt-1.5 w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
          />
        ))}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">Rodapé (opcional, sem variável)</label>
        <input
          value={footerTexto}
          onChange={(e) => setFooterTexto(e.target.value)}
          maxLength={LIMITE_FOOTER}
          placeholder="Plauz Produções"
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm text-gray-300 light:text-gray-700">
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
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
            />

            <div className="flex flex-wrap gap-3 text-xs text-gray-400 light:text-gray-600">
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
                <p className="text-[11px] text-gray-400 font-mono light:text-gray-600">{urlRastreadaPreview}</p>
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
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
              />
            )}

            {botaoModo === "flow" && (
              flows.length === 0 ? (
                <button onClick={() => void carregarFlows()} className="text-[11px] text-blue-400 hover:text-blue-300 light:text-blue-700 light:hover:text-blue-800">
                  Carregar Flows
                </button>
              ) : flowsDisponiveis.length > 0 ? (
                <>
                  {botaoFlowMetaIdOriginal && !botaoFlowId && (
                    <p className="text-[11px] text-amber-400">Este botão abria um Flow — escolha de novo abaixo.</p>
                  )}
                  <select
                    value={botaoFlowId}
                    onChange={(e) => setBotaoFlowId(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm light:bg-gray-100 light:border-gray-300 light:text-gray-900"
                  >
                    <option value="">Escolha o Flow</option>
                    {flowsDisponiveis.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-[11px] text-amber-400">
                  Nenhum Flow ativo e publicado neste número — crie/publique um em Automações.
                </p>
              )
            )}

            {botaoModo === "quick_reply" && (
              <p className="text-[11px] text-gray-400 light:text-gray-600">
                Sem link — a resposta chega como mensagem, rastreável do mesmo jeito que os
                botões de opt-out.
              </p>
            )}
          </div>
        )}
      </div>

      {bodyTexto.trim() && (
        <div className="bg-gray-800/40 border border-gray-800 rounded-md p-3 space-y-1 light:border-gray-200">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide light:text-gray-600">Como o fã vê</p>
          {headerTipo === "texto" && headerTexto.trim() && <p className="text-sm text-white font-semibold light:text-gray-900">{previewHeader}</p>}
          {headerTipo === "midia" && (
            <p className="text-xs text-gray-400 light:text-gray-600">🖼 {headerMidiaNome ?? `cabeçalho de ${headerMidiaFormato.toLowerCase()}`}</p>
          )}
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{previewBody}</p>
          {footerTexto.trim() && <p className="text-xs text-gray-400 light:text-gray-600">{footerTexto}</p>}
          {temBotao && botaoTexto.trim() && (
            <p className="text-xs text-green-400 pt-1 border-t border-gray-800 mt-1 light:text-green-700 light:border-gray-200">↗ {botaoTexto}</p>
          )}
        </div>
      )}

      {erro && <p className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">{erro}</p>}

      <Button
        variant="primary"
        size="md"
        onClick={() => void enviar()}
        disabled={enviando || (!editando && !titulo.trim()) || !bodyTexto.trim() || !credentialId || faltaMidia}
        className="w-full justify-center"
      >
        {enviando ? "Enviando..." : editando ? "Reenviar edição" : "Enviar para revisão"}
      </Button>
    </div>
  );
}
