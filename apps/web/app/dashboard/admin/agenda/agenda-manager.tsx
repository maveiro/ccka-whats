"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

interface Show {
  id: string;
  show_id_origem: string | null;
  publicado: boolean;
  artista: string;
  cidade: string | null;
  teatro: string | null;
  data_show: string | null;
  status_venda: string | null;
  link_compra: string | null;
  updated_at: string;
}

const STATUS = ["à venda", "esgotado", "últimos ingressos", "em breve", "cancelado"];

// A agenda é ESPELHO do board do Monday (decisão do fundador, 16/09/2026):
// não há mais cadastro manual de show aqui. O que a tela faz é mostrar o que
// foi sincronizado e permitir limpar o que sobrou da época do cadastro à mão.
//
// Linha sincronizada não é editável de propósito: a próxima rodada do sync
// (de hora em hora) desfaria a edição, e um campo que volta ao valor antigo
// sozinho é pior que um campo que não deixa editar. Correção de show se faz
// no board.
//
// A EXCEÇÃO é `publicado`: não é dado do board, é escolha de quem cuida da
// central — o board diz o que está à venda, isto diz o que vai ao ar. O sync
// não a desfaz em nenhum dos dois sentidos, então é a única ação que faz
// sentido numa linha sincronizada.
//
// Show novo chega DESPUBLICADO (migration agenda_chega_despublicado). Isso faz
// da tela uma fila de trabalho, não só uma listagem: se os novos não
// aparecerem em destaque, eles ficam invisíveis para o fã e ninguém descobre
// até alguém perguntar por um show que existe e não aparece. É o que o bloco
// de "aguardando publicação" abaixo resolve.

/** ISO -> valor de <input type="datetime-local"> em horário de Brasília.
 *  Usar o fuso do navegador aqui faria a data mudar de valor ao editar de
 *  outro fuso, e o que a API grava é sempre horário de Brasília. */
function paraInputDatetime(iso: string | null): string {
  if (!iso) return "";
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
  return partes.replace(" ", "T");
}

export default function AgendaManager({
  initial,
  artistasSugeridos,
  isAdmin,
  agoraIso,
}: {
  initial: Show[];
  artistasSugeridos: string[];
  isAdmin: boolean;
  agoraIso: string;
}) {
  const agora = new Date(agoraIso).getTime();
  const [shows, setShows] = useState(initial);
  const [filtroArtista, setFiltroArtista] = useState("");

  const artistas = useMemo(
    () => Array.from(new Set([...artistasSugeridos, ...shows.map((s) => s.artista)])).filter(Boolean).sort(),
    [artistasSugeridos, shows],
  );

  const visiveis = filtroArtista ? shows.filter((s) => s.artista === filtroArtista) : shows;
  const manuais = shows.filter((s) => !s.show_id_origem);
  const sincronizados = shows.length - manuais.length;
  const aguardando = shows.filter((s) => !s.publicado);
  const [publicandoTodos, setPublicandoTodos] = useState(false);

  async function publicarTodos() {
    setPublicandoTodos(true);
    try {
      const res = await fetch("/api/agenda/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: aguardando.map((s) => s.id), publicado: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      const publicadosAgora = new Set(aguardando.map((s) => s.id));
      setShows((ss) => ss.map((s) => publicadosAgora.has(s.id) ? { ...s, publicado: true } : s));
      toast.success(`${json.alterados} show(s) publicado(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPublicandoTodos(false);
    }
  }

  async function atualizar(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/agenda/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao salvar");
      return;
    }
    setShows((ss) => ss.map((s) => (s.id === id ? json : s)).sort(ordenarPorData));
  }

  async function remover(id: string) {
    if (!confirm("Remover este show da agenda? Ele deixa de aparecer no Flow imediatamente.")) return;
    const res = await fetch(`/api/agenda/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao remover");
      return;
    }
    setShows((ss) => ss.filter((s) => s.id !== id));
  }

  return (
    <div className="space-y-8">
      {aguardando.length > 0 && (
        <div className="text-xs bg-amber-900/20 border border-amber-900 rounded px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-amber-300">
            <b>{aguardando.length} show(s) aguardando publicação.</b> Show novo do board
            chega fora do ar de propósito — enquanto estiver assim, o fã não vê, mesmo
            estando à venda.
          </p>
          <button
            onClick={publicarTodos}
            disabled={publicandoTodos}
            className="shrink-0 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {publicandoTodos ? "Publicando…" : "Publicar todos"}
          </button>
        </div>
      )}

      {manuais.length > 0 && (
        <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded px-3 py-2">
          {manuais.length} show(s) desta lista <b>não vêm do board</b> — sobraram da época
          do cadastro à mão. O Flow responde eles junto dos sincronizados, então valem
          uma conferida: se o show existe no board, remova a linha daqui para não
          aparecer duas vezes.
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Shows na agenda <span className="text-gray-500 font-normal">({visiveis.length})</span>
            {sincronizados > 0 && (
              <span className="text-gray-500 font-normal text-xs ml-2">
                {sincronizados} do Monday{manuais.length > 0 && `, ${manuais.length} fora do board`}
                {aguardando.length > 0 && `, ${aguardando.length} aguardando publicação`}
              </span>
            )}
          </h2>
          {artistas.length > 1 && (
            <select value={filtroArtista} onChange={(e) => setFiltroArtista(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white">
              <option value="">Todos os artistas</option>
              {artistas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>

        {visiveis.length === 0 && (
          <p className="text-sm text-gray-500">
            Nenhum show na agenda. Crie uma agenda sincronizada acima e clique em
            &quot;sincronizar agora&quot;.
          </p>
        )}

        {visiveis.map((show) => (
          <ShowLinha key={show.id} show={show} isAdmin={isAdmin} agora={agora}
            onAtualizar={(patch) => atualizar(show.id, patch)} onRemover={() => remover(show.id)} />
        ))}
      </div>
    </div>
  );
}

function ordenarPorData(a: Show, b: Show): number {
  if (!a.data_show) return 1;
  if (!b.data_show) return -1;
  return a.data_show.localeCompare(b.data_show);
}

function ShowLinha({
  show,
  isAdmin,
  agora,
  onAtualizar,
  onRemover,
}: {
  show: Show;
  isAdmin: boolean;
  agora: number;
  onAtualizar: (patch: Record<string, unknown>) => void;
  onRemover: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [cidade, setCidade] = useState(show.cidade ?? "");
  const [teatro, setTeatro] = useState(show.teatro ?? "");
  const [dataShow, setDataShow] = useState(paraInputDatetime(show.data_show));
  const [statusVenda, setStatusVenda] = useState(show.status_venda ?? STATUS[0]);
  const [linkCompra, setLinkCompra] = useState(show.link_compra ?? "");

  const passado = show.data_show ? new Date(show.data_show).getTime() < agora : false;
  const doBoard = !!show.show_id_origem;

  if (!editando) {
    return (
      <div className={`border rounded px-4 py-3 flex items-start justify-between gap-3 ${passado ? "opacity-60" : ""} ${show.publicado ? "border-gray-800" : "border-amber-900/60 bg-amber-950/10"}`}>
        <div className="min-w-0">
          <p className="text-sm text-white">
            {show.cidade ?? "—"}
            {show.teatro ? <span className="text-gray-400"> · {show.teatro}</span> : null}
            {passado && <span className="text-[11px] text-gray-500 ml-2">(já passou)</span>}
            {!doBoard && (
              <span className="text-[11px] text-amber-400/80 ml-2">fora do board</span>
            )}
            {!show.publicado && (
              <span className="text-[11px] text-amber-400 ml-2">não publicado</span>
            )}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {show.artista} ·{" "}
            {show.data_show
              ? new Date(show.data_show).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
              : "sem data"}
            {show.status_venda ? ` · ${show.status_venda}` : ""}

          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onAtualizar({ publicado: !show.publicado })}
            className={`text-xs ${show.publicado ? "text-gray-400 hover:text-amber-400" : "text-amber-400 hover:text-amber-300"}`}
            title={show.publicado
              ? "Esconder este show da central, sem mexer no board"
              : "Voltar a mostrar este show na central"}
          >
            {show.publicado ? "despublicar" : "publicar"}
          </button>
          {doBoard ? (
            // Fora de `publicado`, sem ações: a próxima rodada do sync
            // desfaria qualquer edição, e remover aqui só faria o show voltar
            // na hora seguinte. Correção de show sincronizado se faz no board.
            <span className="text-[11px] text-gray-400">vem do Monday</span>
          ) : (
            <>
              <button onClick={() => setEditando(true)} className="text-xs text-gray-400 hover:text-white">editar</button>
              {isAdmin && (
                <button onClick={onRemover} className="text-xs text-gray-500 hover:text-red-400">remover</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-700 rounded p-4 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs text-gray-400 space-y-1">
          <span>Cidade</span>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>Teatro / casa</span>
          <input value={teatro} onChange={(e) => setTeatro(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>Data e hora</span>
          <input type="datetime-local" value={dataShow} onChange={(e) => setDataShow(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>Status</span>
          <select value={statusVenda} onChange={(e) => setStatusVenda(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white">
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-400 space-y-1 col-span-2">
          <span>Link de compra</span>
          <input value={linkCompra} onChange={(e) => setLinkCompra(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            onAtualizar({ cidade, teatro, dataShow, statusVenda, linkCompra });
            setEditando(false);
          }}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-3 py-1.5"
        >
          Salvar
        </button>
        <button onClick={() => setEditando(false)} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">
          Cancelar
        </button>
      </div>
    </div>
  );
}
