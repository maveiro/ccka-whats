// Sincroniza a agenda da central a partir do painel-shows, que é quem tem a
// integração com o Monday (ponte da ADR 0006 do plauz-core; PRD em
// docs/prd/prd-agenda-via-painel-shows.md).
//
// Esta função NUNCA fala com o Monday. Ela lê a API interna do painel-shows e
// grava em agenda_shows_sync via sincronizar_agenda_shows(). O endpoint do
// Flow, por sua vez, nunca fala com esta função — lê só a cópia local, porque
// tem teto de latência do cliente do WhatsApp.
//
// verify_jwt=true — chamada pelo pg_cron (com o segredo de internal_secrets) e
// pelo botão "Sincronizar agora" do painel, ambos com service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FETCH_TIMEOUT_MS = 20_000;

// Rótulo do board → o texto que o fã lê na lista do Flow. O que não estiver
// aqui desce em minúsculas: rótulo novo no board não pode virar erro, mas
// também não deve chegar ao fã em MAIÚSCULA no meio da frase.
const STATUS_PARA_FA: Record<string, string> = {
  "vendendo": "à venda",
  "esgotado": "esgotado",
};

interface Conexao {
  id: string;
  tenant_id: string;
  base_url: string;
  token: string;
}

interface Filtro {
  id: string;
  tenant_id: string;
  artista_origem: string;
  status_permitidos: string[];
  espetaculos: string[] | null;
  janela_dias: number | null;
}

/** Contrato da API interna do painel-shows (GET /api/interno/agenda). */
interface ShowDoPainel {
  id: string;
  monday_item_id: string | null;
  artista: string | null;
  elemento: string | null;
  cidade: string | null;
  estado: string | null;
  teatro: string | null;
  /** ISO com offset quando o painel conhece a hora; só a data quando não. */
  data_hora: string | null;
  data_show: string | null;
  status_monday: string | null;
  link_vendas: string | null;
}

interface LinhaAgenda {
  show_id_origem: string;
  cidade: string | null;
  teatro: string | null;
  data_hora: string | null;
  status_venda: string | null;
  link_compra: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.json().catch(() => ({})) as { tenantId?: string; filtroId?: string };

  let query = supabase
    .from("agenda_conexoes")
    .select("id, tenant_id, base_url, token")
    .eq("ativo", true);

  if (body.tenantId) query = query.eq("tenant_id", body.tenantId);

  const { data: conexoes, error: erroConexoes } = await query;

  if (erroConexoes) {
    return new Response(JSON.stringify({ error: erroConexoes.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }

  const resultados: unknown[] = [];

  for (const conexao of (conexoes ?? []) as Conexao[]) {
    resultados.push(await sincronizarTenant(conexao, body.filtroId ?? null));
  }

  return new Response(JSON.stringify({ tenants: resultados }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function sincronizarTenant(conexao: Conexao, filtroId: string | null) {
  let filtrosQuery = supabase
    .from("agenda_filtros")
    .select("id, tenant_id, artista_origem, status_permitidos, espetaculos, janela_dias")
    .eq("tenant_id", conexao.tenant_id)
    .eq("ativo", true);

  if (filtroId) filtrosQuery = filtrosQuery.eq("id", filtroId);

  const { data: filtros } = await filtrosQuery;
  if (!filtros || filtros.length === 0) {
    return { tenantId: conexao.tenant_id, agendas: 0, motivo: "nenhuma agenda ativa" };
  }

  // Pede ao painel-shows que atualize o espelho do board ANTES de ler. O
  // cron de lá é diário (limite do plano Hobby dele), e agenda de show muda
  // mais que isso — então quem dita o ritmo é este sync. Falhar aqui não
  // aborta nada: serve-se o espelho que existe, que é velho mas real, e o
  // evento registra a idade.
  const espelho = await pedirAtualizacaoDoEspelho(conexao);
  if (espelho.erro) {
    await logEvent(conexao.tenant_id, "agenda_espelho_nao_atualizado", {
      baseUrl: conexao.base_url,
    }, espelho.erro);
  }

  let shows: ShowDoPainel[];
  let sincronizadoEm: string | null = null;
  try {
    const resposta = await buscarShows(conexao);
    shows = resposta.shows;
    sincronizadoEm = resposta.sincronizado_em;
  } catch (err) {
    // Falha de rede NUNCA pode virar "nenhum show": sincronizar_agenda_shows
    // com lista vazia apaga a agenda daquele filtro (comportamento correto
    // para artista sem datas, desastroso para um timeout). Aborta o tenant
    // inteiro e deixa a agenda anterior no ar.
    await logEvent(conexao.tenant_id, "agenda_sync_erro", {
      baseUrl: conexao.base_url,
    }, err instanceof Error ? err.message : String(err));
    return { tenantId: conexao.tenant_id, erro: String(err) };
  }

  const agendas: unknown[] = [];

  for (const filtro of filtros as Filtro[]) {
    const { linhas, ignorados } = aplicarFiltro(shows, filtro);

    const { data: resumo, error } = await supabase.rpc("sincronizar_agenda_shows", {
      p_filtro_id: filtro.id,
      p_linhas: linhas,
    });

    if (error) {
      await logEvent(conexao.tenant_id, "agenda_sync_erro", {
        filtroId: filtro.id,
        artistaOrigem: filtro.artista_origem,
      }, error.message);
      agendas.push({ filtroId: filtro.id, erro: error.message });
      continue;
    }

    // Agenda que ficou vazia é o defeito mais provável desta integração (um
    // rótulo renomeado no board), e o mais silencioso: ninguém reclama de
    // agenda vazia até um fã perguntar. Por isso vira evento próprio.
    if (linhas.length === 0) {
      await logEvent(conexao.tenant_id, "agenda_sync_vazia", {
        filtroId: filtro.id,
        artistaOrigem: filtro.artista_origem,
        statusPermitidos: filtro.status_permitidos,
        recebidosDoPainel: shows.length,
        ignorados,
      });
    }

    await logEvent(conexao.tenant_id, "agenda_sync", {
      filtroId: filtro.id,
      artistaOrigem: filtro.artista_origem,
      recebidosDoPainel: shows.length,
      espelhoSincronizadoEm: sincronizadoEm,
      ignorados,
      ...(resumo as Record<string, unknown>),
    });

    agendas.push({ filtroId: filtro.id, artistaOrigem: filtro.artista_origem, ignorados, ...(resumo as Record<string, unknown>) });
  }

  return { tenantId: conexao.tenant_id, agendas };
}

/**
 * POST /api/interno/agenda/sincronizar — o painel relê o board do Monday.
 *
 * Erro é devolvido, não lançado: o desfecho certo é seguir com o espelho
 * atual, e não deixar a central sem agenda porque a atualização falhou.
 */
async function pedirAtualizacaoDoEspelho(conexao: Conexao): Promise<{ erro: string | null }> {
  const url = `${conexao.base_url.replace(/\/+$/, "")}/api/interno/agenda/sincronizar`;
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${conexao.token}`, Accept: "application/json" },
      // Ler o board inteiro lá demora mais que servir o espelho: teto próprio,
      // maior que o da leitura.
      signal: AbortSignal.timeout(60_000),
    });
    if (!resposta.ok) return { erro: `painel-shows respondeu ${resposta.status} ao atualizar o espelho` };
    return { erro: null };
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}

async function buscarShows(conexao: Conexao): Promise<{ shows: ShowDoPainel[]; sincronizado_em: string | null }> {
  // `desde` = hoje: a central só mostra o que ainda não aconteceu, e o board
  // tem anos de histórico.
  const hoje = new Date().toISOString().slice(0, 10);
  const url = `${conexao.base_url.replace(/\/+$/, "")}/api/interno/agenda?desde=${hoje}`;

  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${conexao.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!resposta.ok) {
    throw new Error(`painel-shows respondeu ${resposta.status} em ${url}`);
  }

  const json = await resposta.json() as { shows?: ShowDoPainel[]; sincronizado_em?: string | null };
  if (!Array.isArray(json.shows)) {
    throw new Error("resposta do painel-shows sem o array `shows`");
  }
  return { shows: json.shows, sincronizado_em: json.sincronizado_em ?? null };
}

/**
 * Aplica o filtro de UMA agenda sobre o que o painel-shows devolveu.
 *
 * O filtro é comparado por RÓTULO (`IB`, `Vendendo`), nunca pelo índice que a
 * API do Monday exige em query_params — índice depende da ordem de criação dos
 * rótulos no board e mudaria de significado sem ninguém notar (ver PRD,
 * armadilha 4). Comparação sem acento e sem caixa: "à venda"/"À Venda" no
 * board não podem produzir agendas diferentes.
 */
export function aplicarFiltro(
  shows: ShowDoPainel[],
  filtro: Filtro,
): { linhas: LinhaAgenda[]; ignorados: Record<string, number> } {
  const ignorados = { artista: 0, status: 0, espetaculo: 0, passado: 0, fora_da_janela: 0, sem_origem: 0 };

  const agora = Date.now();
  const limite = filtro.janela_dias ? agora + filtro.janela_dias * 86_400_000 : null;

  const statusOk = new Set(filtro.status_permitidos.map(normalizar));
  const espetaculosOk = filtro.espetaculos ? new Set(filtro.espetaculos.map(normalizar)) : null;

  const linhas: LinhaAgenda[] = [];

  for (const show of shows) {
    if (normalizar(show.artista) !== normalizar(filtro.artista_origem)) { ignorados.artista++; continue; }
    if (!statusOk.has(normalizar(show.status_monday))) { ignorados.status++; continue; }
    if (espetaculosOk && !espetaculosOk.has(normalizar(show.elemento))) { ignorados.espetaculo++; continue; }

    const origem = show.monday_item_id ?? show.id;
    if (!origem) { ignorados.sem_origem++; continue; }

    const quando = resolverQuando(show);
    if (quando === null) { ignorados.passado++; continue; }
    if (quando.getTime() < agora) { ignorados.passado++; continue; }
    if (limite && quando.getTime() > limite) { ignorados.fora_da_janela++; continue; }

    linhas.push({
      show_id_origem: String(origem),
      cidade: montarCidade(show),
      teatro: show.teatro,
      data_hora: quando.toISOString(),
      status_venda: STATUS_PARA_FA[normalizar(show.status_monday)] ?? (show.status_monday?.toLowerCase() ?? null),
      link_compra: show.link_vendas,
    });
  }

  return { linhas, ignorados };
}

/**
 * Data/hora do show.
 *
 * `data_hora` do painel já vem com offset quando ele conhece a hora. Sem hora,
 * cai para a meia-noite de São Paulo — e é essa meia-noite exata que a tela do
 * Flow lê como "hora a confirmar" em vez de mostrar "00:00" para um show de
 * noite (ver formatarData em flow-endpoint/agenda.ts). Show real à meia-noite
 * não existe nesta operação: os horários vão de 16h30 a 22h30.
 */
function resolverQuando(show: ShowDoPainel): Date | null {
  if (show.data_hora) {
    const d = new Date(show.data_hora);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (show.data_show) {
    const d = new Date(`${show.data_show}T00:00:00-03:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** "Curitiba/PR" — o formato que a lista do fã já mostra. */
function montarCidade(show: ShowDoPainel): string | null {
  const cidade = show.cidade?.trim();
  const estado = show.estado?.trim();
  if (cidade && estado) return `${cidade}/${estado}`;
  return cidade || estado || null;
}

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

async function logEvent(
  tenantId: string,
  eventType: string,
  payload: unknown,
  error?: string,
): Promise<void> {
  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: null,
    event_type: eventType,
    payload,
    error: error ?? null,
  });
}
