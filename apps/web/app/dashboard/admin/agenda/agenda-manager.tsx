"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

interface Show {
  id: string;
  show_id_origem: string | null;
  artista: string;
  cidade: string | null;
  teatro: string | null;
  data_show: string | null;
  status_venda: string | null;
  link_compra: string | null;
  updated_at: string;
}

const STATUS = ["à venda", "esgotado", "últimos ingressos", "em breve", "cancelado"];

/** Dias desde a última edição — o PRD pede isso visível: a V1 é manual e pode
 *  ficar defasada em relação ao painel-shows, e esse é o risco operacional
 *  aceito conscientemente.
 *
 *  `agora` vem do servidor em vez de Date.now(): chamar relógio durante o
 *  render é impuro (o resultado muda a cada re-render sem o estado mudar), e o
 *  React 19 rejeita isso. Para "faz X dias" e "já passou", o instante em que a
 *  página carregou é precisão de sobra. */
function diasDesde(iso: string, agora: number): number {
  return Math.floor((agora - new Date(iso).getTime()) / 86_400_000);
}

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
  const [salvando, setSalvando] = useState(false);

  const [artista, setArtista] = useState(artistasSugeridos[0] ?? "");
  const [cidade, setCidade] = useState("");
  const [teatro, setTeatro] = useState("");
  const [dataShow, setDataShow] = useState("");
  const [statusVenda, setStatusVenda] = useState(STATUS[0]);
  const [linkCompra, setLinkCompra] = useState("");

  const artistas = useMemo(
    () => Array.from(new Set([...artistasSugeridos, ...shows.map((s) => s.artista)])).filter(Boolean).sort(),
    [artistasSugeridos, shows],
  );

  const visiveis = filtroArtista ? shows.filter((s) => s.artista === filtroArtista) : shows;

  const maisDesatualizado = shows.length > 0
    ? Math.max(...shows.map((s) => diasDesde(s.updated_at, agora)))
    : 0;

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!artista.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artista, cidade, teatro, dataShow, statusVenda, linkCompra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao cadastrar");
      setShows((s) => [...s, json].sort(ordenarPorData));
      setCidade(""); setTeatro(""); setDataShow(""); setLinkCompra("");
      toast.success("Show cadastrado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar show");
    } finally {
      setSalvando(false);
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
      {shows.length > 0 && maisDesatualizado >= 7 && (
        <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded px-3 py-2">
          Há shows sem atualização há {maisDesatualizado} dias. Esta agenda é preenchida
          à mão (V1) — se o que está aqui divergir da fonte oficial, o Flow vai
          responder o que está aqui.
        </p>
      )}

      <form onSubmit={adicionar} className="border border-gray-800 rounded p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Adicionar show</h2>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-400 space-y-1">
            <span>Artista</span>
            <input
              list="artistas-conhecidos"
              value={artista}
              onChange={(e) => setArtista(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            />
            <datalist id="artistas-conhecidos">
              {artistas.map((a) => <option key={a} value={a} />)}
            </datalist>
          </label>
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
          <label className="text-xs text-gray-400 space-y-1">
            <span>Link de compra</span>
            <input value={linkCompra} onChange={(e) => setLinkCompra(e.target.value)} placeholder="https://…"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
        </div>
        <button type="submit" disabled={salvando || !artista.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded px-3 py-1.5">
          {salvando ? "Salvando…" : "Adicionar"}
        </button>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Shows cadastrados <span className="text-gray-500 font-normal">({visiveis.length})</span>
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
          <p className="text-sm text-gray-500">Nenhum show cadastrado.</p>
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

  if (!editando) {
    return (
      <div className={`border border-gray-800 rounded px-4 py-3 flex items-start justify-between gap-3 ${passado ? "opacity-60" : ""}`}>
        <div className="min-w-0">
          <p className="text-sm text-white">
            {show.cidade ?? "—"}
            {show.teatro ? <span className="text-gray-400"> · {show.teatro}</span> : null}
            {passado && <span className="text-[11px] text-gray-500 ml-2">(já passou)</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {show.artista} ·{" "}
            {show.data_show
              ? new Date(show.data_show).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
              : "sem data"}
            {show.status_venda ? ` · ${show.status_venda}` : ""}
            {show.show_id_origem ? " · sincronizado" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditando(true)} className="text-xs text-gray-400 hover:text-white">editar</button>
          {isAdmin && (
            <button onClick={onRemover} className="text-xs text-gray-500 hover:text-red-400">remover</button>
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
