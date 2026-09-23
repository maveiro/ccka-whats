"use client";

import { useState } from "react";
import { toast } from "sonner";
import Button from "@/components/ui/button";

// Agendas sincronizadas com o board do Monday, pela ponte com o painel-shows
// (PRD docs/prd/prd-agenda-via-painel-shows.md).
//
// A tela existe para o admin declarar COMO o board é filtrado para cada
// número — e para tornar visível o defeito mais provável desta integração:
// filtro que deixou de casar (rótulo renomeado no board) e devolve agenda
// vazia sem erro nenhum.

interface Filtro {
  id: string;
  cloud_credential_id: string;
  artista_origem: string;
  status_permitidos: string[];
  espetaculos: string[] | null;
  janela_dias: number | null;
  ativo: boolean;
  ultima_sync_em: string | null;
  ultima_sync_resumo: Resumo | null;
  numero: string | null;
  artista_central: string | null;
}

interface Resumo {
  recebidos?: number;
  inseridos?: number;
  atualizados?: number;
  removidos?: number;
}

interface Credencial {
  id: string;
  numero: string;
  artista: string | null;
}

interface Opcoes {
  artistas: string[];
  status: string[];
  espetaculos: string[];
}

interface Tema {
  nome: string;
  artista_nome: string | null;
  tem_sinopse: boolean;
  tem_arte: boolean;
  imagem_bytes: number | null;
  imagem_erro: string | null;
}

export default function AgendaFontes({
  filtrosIniciais,
  credenciais,
  conexaoConfigurada,
  isAdmin,
  temas,
  espetaculosSemTema,
}: {
  filtrosIniciais: Filtro[];
  credenciais: Credencial[];
  conexaoConfigurada: boolean;
  isAdmin: boolean;
  temas: Tema[];
  espetaculosSemTema: string[];
}) {
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  // Conexão
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [salvandoConexao, setSalvandoConexao] = useState(false);
  const [temConexao, setTemConexao] = useState(conexaoConfigurada);

  // Nova agenda
  const [credencialId, setCredencialId] = useState("");
  const [artistaOrigem, setArtistaOrigem] = useState("");
  const [statusEscolhidos, setStatusEscolhidos] = useState<string[]>(["Vendendo", "Esgotado"]);
  const [espetaculos, setEspetaculos] = useState<string[]>([]);
  const [janelaDias, setJanelaDias] = useState("");

  const semAgenda = credenciais.filter((c) => !filtros.some((f) => f.cloud_credential_id === c.id));

  async function carregarOpcoes() {
    setCarregandoOpcoes(true);
    try {
      const res = await fetch("/api/agenda/opcoes");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      setOpcoes(json as Opcoes);
    } catch (err) {
      // Mensagem crua de propósito: "dropdown vazio" e "painel fora do ar"
      // precisam ser distinguíveis por quem está na tela.
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregandoOpcoes(false);
    }
  }

  async function salvarConexao() {
    setSalvandoConexao(true);
    try {
      const res = await fetch("/api/agenda/conexao", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
      setTemConexao(true);
      setToken("");
      toast.success("Conexão salva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvandoConexao(false);
    }
  }

  async function criarAgenda() {
    setCriando(true);
    try {
      const res = await fetch("/api/agenda/filtros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudCredentialId: credencialId,
          artistaOrigem,
          statusPermitidos: statusEscolhidos,
          espetaculos,
          janelaDias: janelaDias ? Number(janelaDias) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);

      const cred = credenciais.find((c) => c.id === credencialId);
      setFiltros((prev) => [...prev, {
        id: json.id,
        cloud_credential_id: credencialId,
        artista_origem: artistaOrigem,
        status_permitidos: statusEscolhidos,
        espetaculos: espetaculos.length > 0 ? espetaculos : null,
        janela_dias: janelaDias ? Number(janelaDias) : null,
        ativo: true,
        ultima_sync_em: null,
        ultima_sync_resumo: null,
        numero: cred?.numero ?? null,
        artista_central: cred?.artista ?? null,
      }]);
      setCredencialId("");
      setArtistaOrigem("");
      setJanelaDias("");
      setEspetaculos([]);
      toast.success("Agenda criada — sincronize para trazer os shows");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCriando(false);
    }
  }

  async function sincronizar(filtroId?: string) {
    setSincronizando(filtroId ?? "todos");
    try {
      const res = await fetch("/api/agenda/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filtroId ? { filtroId } : {}),
      });

      // A resposta pode NÃO ser JSON: quando a rota estoura o tempo limite da
      // Vercel, o que volta é uma página de erro em HTML, e `res.json()`
      // quebrava com "Unexpected token '<'" — erro que não diz nada a quem
      // está na tela (aconteceu em 17/09/2026, com a sincronização levando
      // 57s do lado do painel-shows).
      const bruto = await res.text();
      let json: { error?: string; tenants?: { agendas?: (Resumo & { filtroId: string; erro?: string })[] }[] };
      try {
        json = JSON.parse(bruto);
      } catch {
        throw new Error(
          res.ok
            ? "resposta inesperada do servidor"
            : `a sincronização não respondeu a tempo (${res.status}). O board pode estar grande demais para uma rodada só — tente de novo em instantes.`,
        );
      }

      if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);

      const agendas = (json.tenants?.[0]?.agendas ?? []) as (Resumo & { filtroId: string; erro?: string })[];
      const erro = agendas.find((a) => a.erro);
      if (erro) throw new Error(erro.erro);

      const total = agendas.reduce((s, a) => s + (a.inseridos ?? 0) + (a.atualizados ?? 0), 0);
      const removidos = agendas.reduce((s, a) => s + (a.removidos ?? 0), 0);
      toast.success(`${total} show(s) na agenda${removidos > 0 ? `, ${removidos} removido(s)` : ""}`);

      setFiltros((prev) => prev.map((f) => {
        const r = agendas.find((a) => a.filtroId === f.id);
        return r ? { ...f, ultima_sync_em: new Date().toISOString(), ultima_sync_resumo: r } : f;
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSincronizando(null);
    }
  }

  async function salvarEdicao(filtro: Filtro, patch: {
    artistaOrigem: string;
    statusPermitidos: string[];
    espetaculos: string[];
    janelaDias: number | null;
  }) {
    const res = await fetch(`/api/agenda/filtros/${filtro.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistaOrigem: patch.artistaOrigem,
        statusPermitidos: patch.statusPermitidos,
        espetaculos: patch.espetaculos,
        janelaDias: patch.janelaDias ?? null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? `Erro ${res.status}`);
      return;
    }

    setFiltros((prev) => prev.map((f) => f.id === filtro.id ? {
      ...f,
      artista_origem: patch.artistaOrigem,
      status_permitidos: patch.statusPermitidos,
      espetaculos: patch.espetaculos.length > 0 ? patch.espetaculos : null,
      janela_dias: patch.janelaDias,
    } : f));
    setEditando(null);
    // O filtro mudou, então o que está na agenda do fã é de outro filtro:
    // sincronizar é o passo que reconcilia, e deixar isso implícito seria
    // deixar a agenda divergente da configuração que a tela mostra.
    toast.success("Filtro salvo — sincronize para aplicar à agenda");
  }

  async function alternar(filtro: Filtro) {
    const res = await fetch(`/api/agenda/filtros/${filtro.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: !filtro.ativo }),
    });
    if (!res.ok) {
      toast.error("Não foi possível alterar");
      return;
    }
    setFiltros((prev) => prev.map((f) => f.id === filtro.id ? { ...f, ativo: !f.ativo } : f));
  }

  async function remover(filtro: Filtro) {
    if (!confirm("Remover esta agenda sincronizada? Os shows já trazidos continuam na lista, como linhas manuais.")) return;
    const res = await fetch(`/api/agenda/filtros/${filtro.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Não foi possível remover");
      return;
    }
    setFiltros((prev) => prev.filter((f) => f.id !== filtro.id));
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-white">Sincronização com o Monday</h2>
        <p className="text-xs text-gray-400 mt-1">
          A agenda vem do board de shows, pelo painel-shows. Cada número declara como o
          board é filtrado para ele. O nome do artista na central não é digitado aqui: vem
          do próprio número, que é o mesmo valor que o Flow usa para montar a lista do fã.
        </p>
      </div>

      {isAdmin && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-white">Conexão com o painel-shows</p>
            <span className={`text-xs ${temConexao ? "text-green-400" : "text-amber-400"}`}>
              {temConexao ? "configurada" : "não configurada"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://shows.plauz.com.br"
              className="px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
            />
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token da API interna"
              className="px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
            />
          </div>
          <p className="text-xs text-gray-400">
            O token nunca é reexibido depois de salvo.
          </p>
          <Button variant="primary" size="md" onClick={salvarConexao} disabled={salvandoConexao || !baseUrl || !token}>
            {salvandoConexao ? "Salvando..." : temConexao ? "Substituir conexão" : "Salvar conexão"}
          </Button>
        </div>
      )}

      {filtros.length > 0 && (
        <div className="space-y-2">
          {filtros.map((f) => {
            const r = f.ultima_sync_resumo;
            const naAgenda = (r?.inseridos ?? 0) + (r?.atualizados ?? 0);
            const vazia = f.ultima_sync_em !== null && naAgenda === 0;
            return (
              <div key={f.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">
                      {f.artista_central ?? "(número sem artista)"}{" "}
                      <span className="text-gray-400">· {f.numero ?? "—"}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      board: artista <b className="text-gray-300">{f.artista_origem}</b>
                      {" · status "}
                      <b className="text-gray-300">{f.status_permitidos.join(", ")}</b>
                      {f.espetaculos && <> · espetáculo <b className="text-gray-300">{f.espetaculos.join(", ")}</b></>}
                      {f.janela_dias && <> · próximos {f.janela_dias} dias</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => sincronizar(f.id)}
                      disabled={sincronizando !== null || !temConexao}
                      className="text-xs text-green-400 hover:text-green-300 disabled:opacity-40"
                    >
                      {sincronizando === f.id ? "sincronizando..." : "sincronizar agora"}
                    </button>
                    <button
                      onClick={() => { setEditando(editando === f.id ? null : f.id); if (!opcoes) void carregarOpcoes(); }}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      {editando === f.id ? "fechar" : "editar"}
                    </button>
                    <button onClick={() => alternar(f)} className="text-xs text-gray-400 hover:text-white">
                      {f.ativo ? "pausar" : "retomar"}
                    </button>
                    {isAdmin && (
                      <button onClick={() => remover(f)} className="text-xs text-gray-400 hover:text-red-400">
                        remover
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  {f.ultima_sync_em
                    ? <>última sincronização {new Date(f.ultima_sync_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {naAgenda} show(s) na agenda{(r?.removidos ?? 0) > 0 && `, ${r?.removidos} removido(s)`}</>
                    : "nunca sincronizada"}
                </p>

                {/* Filtro que não casa com nada é o defeito mais provável e o
                    mais silencioso: ninguém reclama de agenda vazia até um fã
                    perguntar. Por isso aparece na tela, não só no log. */}
                {vazia && (
                  <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded-md px-3 py-2">
                    Este filtro não trouxe nenhum show. Confira se o artista e os status
                    ainda existem com esse nome no board — rótulo renomeado lá deixa a
                    agenda vazia sem gerar erro.
                  </p>
                )}
                {!f.ativo && (
                  <p className="text-xs text-gray-400">Pausada: o cron não atualiza esta agenda.</p>
                )}

                {editando === f.id && (
                  <FiltroEditor
                    filtro={f}
                    opcoes={opcoes}
                    carregando={carregandoOpcoes}
                    onCarregarOpcoes={carregarOpcoes}
                    onSalvar={(patch) => salvarEdicao(f, patch)}
                    onCancelar={() => setEditando(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {(temas.length > 0 || espetaculosSemTema.length > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-white">Espetáculos (arte e sinopse na tela do show)</p>
            <p className="text-xs text-gray-400 mt-1">
              Vêm do board de espetáculos. O show diz qual é o espetáculo; o espetáculo
              carrega a arte e o texto. A arte precisa ser JPEG ou PNG anexado na coluna de
              arquivo — reduzimos para caber no limite do WhatsApp.
            </p>
          </div>

          {temas.map((t) => (
            <div key={t.nome} className="text-xs flex items-start justify-between gap-3 border-t border-gray-800 pt-2">
              <div>
                <p className="text-gray-200">
                  {t.nome}
                  {t.artista_nome && <span className="text-gray-400"> · {t.artista_nome}</span>}
                </p>
                {t.imagem_erro && (
                  <p className="text-amber-400 mt-0.5">arte recusada: {t.imagem_erro}</p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className={t.tem_arte ? "text-green-400" : "text-gray-400"}>
                  {t.tem_arte
                    ? `arte${t.imagem_bytes ? ` (${Math.round(t.imagem_bytes / 1024)}KB)` : ""}`
                    : "sem arte"}
                </span>
                <span className={t.tem_sinopse ? "text-green-400" : "text-gray-400"}>
                  {t.tem_sinopse ? "sinopse" : "sem sinopse"}
                </span>
              </div>
            </div>
          ))}

          {/* O defeito silencioso do casamento por nome: rótulo renomeado de
              um lado, ou espetáculo que ninguém cadastrou no board novo. */}
          {espetaculosSemTema.length > 0 && (
            <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded-md px-3 py-2">
              Estes espetáculos aparecem em shows da agenda e <b>não têm item no board de
              espetáculos</b> (ou o nome não casa): {espetaculosSemTema.join(", ")}. Esses
              shows abrem sem arte e sem sinopse.
            </p>
          )}
        </div>
      )}

      {temConexao && semAgenda.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-white">Nova agenda sincronizada</p>
            <button
              onClick={carregarOpcoes}
              className="text-xs text-green-400 hover:text-green-300"
            >
              {carregandoOpcoes ? "carregando..." : opcoes ? "recarregar opções do board" : "carregar opções do board"}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-gray-400 space-y-1">
              <span>Número / central</span>
              <select
                value={credencialId}
                onChange={(e) => setCredencialId(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
              >
                <option value="">Escolher...</option>
                {semAgenda.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.artista}>
                    {c.numero}{c.artista ? ` — ${c.artista}` : " (sem artista definido)"}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>Artista no board</span>
              <select
                value={artistaOrigem}
                onChange={(e) => setArtistaOrigem(e.target.value)}
                disabled={!opcoes}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm disabled:opacity-50"
              >
                <option value="">{opcoes ? "Escolher..." : "carregue as opções"}</option>
                {(opcoes?.artistas ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </div>

          {opcoes && (
            <>
              <div className="space-y-1">
                <p className="text-xs text-gray-400">Status que o fã pode ver</p>
                <div className="flex flex-wrap gap-2">
                  {opcoes.status.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      ativo={statusEscolhidos.includes(s)}
                      onToggle={() => setStatusEscolhidos((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-400">
                  O board é agenda de produção: bloqueio, pauta e corporativo ficam de fora
                  por padrão, e não devem chegar ao fã.
                </p>
              </div>

              {opcoes.espetaculos.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400">Espetáculo (vazio = todos)</p>
                  <div className="flex flex-wrap gap-2">
                    {opcoes.espetaculos.map((e) => (
                      <Chip
                        key={e}
                        label={e}
                        ativo={espetaculos.includes(e)}
                        onToggle={() => setEspetaculos((prev) =>
                          prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <label className="text-xs text-gray-400 space-y-1 block max-w-[220px]">
            <span>Horizonte em dias (vazio = todo o futuro)</span>
            <input
              type="number"
              min={1}
              value={janelaDias}
              onChange={(e) => setJanelaDias(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
            />
          </label>

          <Button variant="primary" size="md" onClick={criarAgenda} disabled={criando || !credencialId || !artistaOrigem || statusEscolhidos.length === 0}>
            {criando ? "Criando..." : "Criar agenda"}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Edição do filtro de uma agenda já criada.
 *
 * Os chips mostram a UNIÃO das opções do board com o que o filtro já tem
 * selecionado. Não é detalhe: se alguém renomear um rótulo no board, o valor
 * antigo deixa de vir nas opções — mostrando só as opções, ele desapareceria
 * da tela continuando gravado, e a agenda vazia não teria explicação
 * visível. Assim o rótulo órfão aparece marcado e dá para removê-lo.
 */
function FiltroEditor({
  filtro, opcoes, carregando, onCarregarOpcoes, onSalvar, onCancelar,
}: {
  filtro: Filtro;
  opcoes: Opcoes | null;
  carregando: boolean;
  onCarregarOpcoes: () => void;
  onSalvar: (patch: { artistaOrigem: string; statusPermitidos: string[]; espetaculos: string[]; janelaDias: number | null }) => void;
  onCancelar: () => void;
}) {
  const [artistaOrigem, setArtistaOrigem] = useState(filtro.artista_origem);
  const [status, setStatus] = useState<string[]>(filtro.status_permitidos);
  const [espetaculos, setEspetaculos] = useState<string[]>(filtro.espetaculos ?? []);
  const [janela, setJanela] = useState(filtro.janela_dias ? String(filtro.janela_dias) : "");
  const [salvando, setSalvando] = useState(false);

  const uniao = (doBoard: string[] | undefined, selecionados: string[]) =>
    Array.from(new Set([...(doBoard ?? []), ...selecionados]));

  const artistasDisponiveis = uniao(opcoes?.artistas, [filtro.artista_origem]);
  const statusDisponiveis = uniao(opcoes?.status, filtro.status_permitidos);
  const espetaculosDisponiveis = uniao(opcoes?.espetaculos, filtro.espetaculos ?? []);

  const foraDoBoard = (valor: string, doBoard: string[] | undefined) =>
    !!opcoes && !(doBoard ?? []).includes(valor);

  return (
    <div className="border-t border-gray-800 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-white">Editar filtro</p>
        {!opcoes && (
          <button onClick={onCarregarOpcoes} className="text-xs text-green-400 hover:text-green-300">
            {carregando ? "carregando..." : "carregar opções do board"}
          </button>
        )}
      </div>

      <label className="text-xs text-gray-400 space-y-1 block max-w-[280px]">
        <span>Artista no board</span>
        <select
          value={artistaOrigem}
          onChange={(e) => setArtistaOrigem(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
        >
          {artistasDisponiveis.map((a) => (
            <option key={a} value={a}>
              {a}{foraDoBoard(a, opcoes?.artistas) ? " (não está mais no board)" : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-1">
        <p className="text-xs text-gray-400">Status que o fã pode ver</p>
        <div className="flex flex-wrap gap-2">
          {statusDisponiveis.map((s) => (
            <Chip
              key={s}
              label={foraDoBoard(s, opcoes?.status) ? `${s} (fora do board)` : s}
              ativo={status.includes(s)}
              onToggle={() => setStatus((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
            />
          ))}
        </div>
      </div>

      {espetaculosDisponiveis.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400">Espetáculo (nenhum marcado = todos)</p>
          <div className="flex flex-wrap gap-2">
            {espetaculosDisponiveis.map((e) => (
              <Chip
                key={e}
                label={foraDoBoard(e, opcoes?.espetaculos) ? `${e} (fora do board)` : e}
                ativo={espetaculos.includes(e)}
                onToggle={() => setEspetaculos((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e])}
              />
            ))}
          </div>
        </div>
      )}

      <label className="text-xs text-gray-400 space-y-1 block max-w-[220px]">
        <span>Horizonte em dias (vazio = todo o futuro)</span>
        <input
          type="number"
          min={1}
          value={janela}
          onChange={(e) => setJanela(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
        />
      </label>

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={async () => {
            setSalvando(true);
            await onSalvar({
              artistaOrigem,
              statusPermitidos: status,
              espetaculos,
              janelaDias: janela ? Number(janela) : null,
            });
            setSalvando(false);
          }}
          disabled={salvando || status.length === 0 || !artistaOrigem}
        >
          {salvando ? "Salvando..." : "Salvar filtro"}
        </Button>
        <Button variant="secondary" size="md" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
      {status.length === 0 && (
        <p className="text-xs text-amber-400">
          Sem nenhum status marcado a agenda fica vazia — por isso o banco recusa.
        </p>
      )}
    </div>
  );
}

function Chip({ label, ativo, onToggle }: { label: string; ativo: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
        ativo
          ? "bg-green-900/40 border-green-700 text-green-300"
          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
