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
import { dimensoesDaImagem } from "./imagem.ts";

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
  // Show que existe mas ainda não vende: entra na agenda com este status, e é
  // a página que troca o botão por lista de espera (migration
  // agenda_labels_e_confirmado).
  "confirmado": "confirmado",
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
  label_ingressos: string | null;
  label_periodo: string | null;
}

interface LinhaAgenda {
  show_id_origem: string;
  cidade: string | null;
  teatro: string | null;
  data_hora: string | null;
  status_venda: string | null;
  link_compra: string | null;
  espetaculo: string | null;
  label_ingressos: string | null;
  label_periodo: string | null;
}

/** Contrato de GET /api/interno/agenda/espetaculos do painel-shows. */
interface EspetaculoDoPainel {
  monday_item_id: string;
  nome: string;
  artista_codigo: string | null;
  artista_nome: string | null;
  sinopse: string | null;
  arte_asset_id: string | null;
  arte_nome: string | null;
  arte_bytes: number | null;
  /** URL assinada e de vida curta — usar agora ou perder. */
  arte_url: string | null;
}

// Teto do componente Image do Flow: 300KB recomendado por imagem, 1MB de
// payload total no data endpoint. Pedimos 800px de largura e qualidade 70 ao
// Storage, e recusamos o que ainda passar de 300KB — melhor tela sem imagem
// que Flow que não abre.
const LARGURA_ARTE = 1080;
const QUALIDADE_ARTE = 75;
const TETO_ARTE_BYTES = 300 * 1024;

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
    .eq("ativo", true)
    // Ordem explícita: sem ela o PostgREST devolve em ordem arbitrária, e a
    // sequência das agendas processadas (e do que vai para o events_log)
    // muda de uma rodada para outra sem motivo.
    .order("created_at", { ascending: true });

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

  // Temas antes das agendas: a tela de detalhe do show lê o tema, e trazer
  // shows novos sem o tema correspondente deixaria a primeira abertura sem
  // arte por uma hora inteira.
  const temas = await sincronizarTemas(conexao);

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

  return { tenantId: conexao.tenant_id, temas, agendas };
}

/**
 * Espelha os espetáculos e a arte de cada um.
 *
 * A arte só é baixada quando o `arte_asset_id` mudou: a URL do painel é
 * assinada e diferente a cada request, então comparar URL significaria
 * baixar tudo de hora em hora, para sempre.
 *
 * Nada aqui pode derrubar a sincronização da agenda — arte é enfeite, agenda
 * é a informação. Todo erro vira evento e segue.
 */
async function sincronizarTemas(conexao: Conexao) {
  let espetaculos: EspetaculoDoPainel[];
  try {
    const url = `${conexao.base_url.replace(/\/+$/, "")}/api/interno/agenda/espetaculos`;
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${conexao.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resposta.ok) {
      throw new Error(`painel-shows respondeu ${resposta.status}: ${await motivoDoErro(resposta)}`);
    }
    const json = await resposta.json() as { espetaculos?: EspetaculoDoPainel[] };
    espetaculos = json.espetaculos ?? [];
  } catch (err) {
    await logEvent(conexao.tenant_id, "agenda_temas_erro", { baseUrl: conexao.base_url },
      err instanceof Error ? err.message : String(err));
    return { erro: "não foi possível ler os espetáculos" };
  }

  let comArte = 0;
  let recusadas = 0;

  for (const esp of espetaculos) {
    const { data: atual } = await supabase
      .from("agenda_temas")
      .select("id, arte_asset_id, imagem_base64, imagem_bytes, imagem_largura, imagem_altura")
      .eq("tenant_id", conexao.tenant_id)
      .eq("nome_chave", chaveTexto(esp.nome))
      .maybeSingle<{
        id: string;
        arte_asset_id: string | null;
        imagem_base64: string | null;
        imagem_bytes: number | null;
        imagem_largura: number | null;
        imagem_altura: number | null;
      }>();

    const arteMudou = (esp.arte_asset_id ?? null) !== (atual?.arte_asset_id ?? null);
    let imagem: {
      base64: string | null; bytes: number | null;
      largura: number | null; altura: number | null; erro: string | null;
    } = {
      base64: atual?.imagem_base64 ?? null,
      bytes: atual?.imagem_bytes ?? null,
      largura: atual?.imagem_largura ?? null,
      altura: atual?.imagem_altura ?? null,
      erro: null,
    };

    if (esp.arte_asset_id && (arteMudou || !atual?.imagem_base64)) {
      imagem = await prepararArte(conexao.tenant_id, esp);
      if (imagem.erro) recusadas++;
    } else if (!esp.arte_asset_id) {
      imagem = { base64: null, bytes: null, largura: null, altura: null, erro: null };
    }

    if (imagem.base64) comArte++;

    const { error } = await supabase.from("agenda_temas").upsert({
      tenant_id: conexao.tenant_id,
      nome: esp.nome,
      monday_item_id: esp.monday_item_id,
      artista_codigo: esp.artista_codigo,
      artista_nome: esp.artista_nome,
      sinopse: esp.sinopse,
      arte_asset_id: esp.arte_asset_id,
      imagem_base64: imagem.base64,
      imagem_bytes: imagem.bytes,
      imagem_largura: imagem.largura,
      imagem_altura: imagem.altura,
      imagem_atualizada_em: imagem.base64 ? new Date().toISOString() : null,
      imagem_erro: imagem.erro,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,nome_chave" });

    if (error) {
      await logEvent(conexao.tenant_id, "agenda_temas_erro", { espetaculo: esp.nome }, error.message);
    }
  }

  await logEvent(conexao.tenant_id, "agenda_temas", {
    recebidos: espetaculos.length,
    comArte,
    recusadas,
  });

  return { recebidos: espetaculos.length, com_arte: comArte, recusadas };
}

/**
 * Baixa a arte do Monday, reduz pelo Storage e devolve base64.
 *
 * O caminho é longo por uma razão: o Flow só aceita base64 com teto de
 * 300KB, e arte de divulgação vem em tamanho de impressão. O Storage faz a
 * redução (a transformação de imagem está ativa neste projeto), o que evita
 * uma biblioteca de imagem dentro da Edge Function.
 *
 * `Accept: image/jpeg` de propósito: sem isso o Storage devolve **webp** para
 * quem aceita webp, e o Flow não aceita webp (verificado em 17/09/2026).
 */
async function prepararArte(
  tenantId: string,
  esp: EspetaculoDoPainel,
): Promise<{ base64: string | null; bytes: number | null; largura: number | null; altura: number | null; erro: string | null }> {
  if (!esp.arte_url) {
    return { base64: null, bytes: null, largura: null, altura: null, erro: "o painel-shows não devolveu URL de download da arte" };
  }

  const extensao = (esp.arte_nome?.split(".").pop() ?? "jpg").toLowerCase();
  if (!["jpg", "jpeg", "png"].includes(extensao)) {
    // O Flow aceita só JPEG e PNG. Converter aqui exigiria biblioteca de
    // imagem; recusar com motivo visível é melhor que imagem que não abre.
    return { base64: null, bytes: null, largura: null, altura: null, erro: `formato .${extensao} não é aceito pelo Flow (use JPEG ou PNG)` };
  }

  const caminho = `${tenantId}/${esp.monday_item_id}.${extensao === "png" ? "png" : "jpg"}`;

  try {
    const original = await fetch(esp.arte_url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!original.ok) {
      return { base64: null, bytes: null, largura: null, altura: null, erro: `download da arte respondeu ${original.status}` };
    }
    const bytes = new Uint8Array(await original.arrayBuffer());

    const { error: erroUpload } = await supabase.storage
      .from("temas")
      .upload(caminho, bytes, {
        contentType: extensao === "png" ? "image/png" : "image/jpeg",
        upsert: true,
      });
    if (erroUpload) return { base64: null, bytes: null, largura: null, altura: null, erro: `Storage: ${erroUpload.message}` };

    const { data: reduzida, error: erroTransform } = await supabase.storage
      .from("temas")
      .download(caminho, {
        transform: {
          width: LARGURA_ARTE,
          quality: QUALIDADE_ARTE,
          // `contain` NÃO é detalhe: sem ele o Storage faz recorte central
          // para preencher a caixa pedida. Achado com a primeira arte real
          // (17/09/2026) — um banner 1919x819 virou 800x819, cortando o logo,
          // metade do título e o rosto da personagem, e o fã viu isso.
          resize: "contain",
        },
      });
    if (erroTransform || !reduzida) {
      return { base64: null, bytes: null, largura: null, altura: null, erro: `redução falhou: ${erroTransform?.message ?? "sem resposta"}` };
    }

    const reduzidaBytes = new Uint8Array(await reduzida.arrayBuffer());
    if (reduzidaBytes.byteLength > TETO_ARTE_BYTES) {
      return {
        base64: null,
        bytes: reduzidaBytes.byteLength,
        largura: null,
        altura: null,
        erro: `arte reduzida ainda tem ${Math.round(reduzidaBytes.byteLength / 1024)}KB (teto do Flow é 300KB)`,
      };
    }

    // As dimensões vão para o Flow como `aspect-ratio`: é o que faz a arte
    // ocupar a tela na proporção certa, seja banner, quadrada ou vertical.
    const medida = dimensoesDaImagem(reduzidaBytes);

    return {
      base64: paraBase64(reduzidaBytes),
      bytes: reduzidaBytes.byteLength,
      largura: medida?.largura ?? null,
      altura: medida?.altura ?? null,
      erro: null,
    };
  } catch (err) {
    return { base64: null, bytes: null, largura: null, altura: null, erro: err instanceof Error ? err.message : String(err) };
  }
}

/** btoa direto estoura a pilha em imagem grande — vai em blocos. */
function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  const bloco = 8192;
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(binario);
}

/** Espelha chave_texto() do banco: minúsculo, sem acento, sem borda. */
function chaveTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
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
      // Teto próprio, maior que o da leitura (ler o board demora mais que
      // servir o espelho) mas MENOR que os 60s da rota que chama esta função
      // pelo painel: se o refresh consumir o orçamento inteiro, a rota morre
      // devolvendo HTML e quem clicou vê "erro de JSON" (17/09/2026). Com o
      // recorte de colunas e janela no painel-shows, a rodada real leva ~9s.
      signal: AbortSignal.timeout(35_000),
    });
    if (!resposta.ok) {
      return { erro: `painel-shows respondeu ${resposta.status} ao atualizar o espelho: ${await motivoDoErro(resposta)}` };
    }
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
    throw new Error(`painel-shows respondeu ${resposta.status} em ${url}: ${await motivoDoErro(resposta)}`);
  }

  const json = await resposta.json() as { shows?: ShowDoPainel[]; sincronizado_em?: string | null };
  if (!Array.isArray(json.shows)) {
    throw new Error("resposta do painel-shows sem o array `shows`");
  }
  return { shows: json.shows, sincronizado_em: json.sincronizado_em ?? null };
}

/**
 * Motivo que o painel-shows dá no corpo ("AGENDA_API_TOKEN não configurado",
 * "Não autorizado"). Sem isso, o events_log guarda um número de status e
 * quem investiga não tem como saber se falta env var no outro app, se o
 * token divergiu ou se o board está inacessível.
 */
async function motivoDoErro(resposta: Response): Promise<string> {
  const corpo = await resposta.json().catch(() => null) as { error?: string } | null;
  return corpo?.error ?? "sem detalhe no corpo";
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
      // Rótulo cru: é o que casa com agenda_temas.nome pela chave
      // normalizada, e é o que a tela mostra quando um show não acha tema.
      espetaculo: show.elemento,
      label_ingressos: show.label_ingressos,
      label_periodo: show.label_periodo,
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
