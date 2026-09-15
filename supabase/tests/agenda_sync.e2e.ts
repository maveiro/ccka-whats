// Teste ponta a ponta do agenda-sync — a ponte que traz a agenda do Monday
// pelo painel-shows (PRD docs/prd/prd-agenda-via-painel-shows.md, Fase 3).
//
// COMO RODAR: `npm run test:db` com o Supabase local de pé. NUNCA contra
// produção — cria e apaga dados.
//
// A API interna do painel-shows é substituída por um stub local: nada sai
// desta máquina, e o payload servido é o mesmo shape verificado contra o board
// 26 | SHOWS PLAUZ em 15/09/2026 (incluindo o que NÃO pode chegar ao fã —
// Bloqueio, Corporativo, show de outro artista).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const STUB_PORT = 8791;
const db = createClient(DB_URL, SERVICE_KEY);

// ─── Stub da API interna do painel-shows ─────────────────────────────────────

interface ShowDoPainel {
  id: string;
  monday_item_id: string | null;
  artista: string | null;
  elemento: string | null;
  cidade: string | null;
  estado: string | null;
  teatro: string | null;
  data_hora: string | null;
  data_show: string | null;
  status_monday: string | null;
  link_vendas: string | null;
}

let servir: ShowDoPainel[] = [];
let statusHttp = 200;
let statusRefresh = 200;
let tokensRecebidos: string[] = [];
let desdeRecebido: string | null = null;
let refreshPedido = 0;

const stub = Deno.serve({ port: STUB_PORT, onListen: () => {} }, (req) => {
  tokensRecebidos.push(req.headers.get("Authorization") ?? "");
  const url = new URL(req.url);

  // POST /api/interno/agenda/sincronizar: o painel relê o board antes de
  // servir. O cron dele é diário, então é este pedido que dá o ritmo.
  if (url.pathname.endsWith("/sincronizar")) {
    refreshPedido++;
    return new Response(JSON.stringify({ gravados: servir.length, removidos: 0, erros: [] }), {
      status: statusRefresh,
      headers: { "Content-Type": "application/json" },
    });
  }

  desdeRecebido = url.searchParams.get("desde");
  if (statusHttp !== 200) return new Response("nope", { status: statusHttp });
  return new Response(JSON.stringify({ shows: servir, sincronizado_em: new Date().toISOString() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Sobe o agenda-sync no host ──────────────────────────────────────────────

Deno.env.set("SUPABASE_URL", DB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const serveOriginal = Deno.serve;
let handler: ((req: Request) => Promise<Response> | Response) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler_: any) => {
  handler = typeof handler_ === "function" ? handler_ : handler_.handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};
await import(new URL("../functions/agenda-sync/index.ts", import.meta.url).href);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = serveOriginal;
if (!handler) throw new Error("agenda-sync não registrou handler");

interface ResultadoAgenda {
  filtroId: string;
  artistaOrigem?: string;
  recebidos?: number;
  inseridos?: number;
  atualizados?: number;
  removidos?: number;
  erro?: string;
  ignorados?: Record<string, number>;
}

async function sincronizar(body: Record<string, unknown> = {}): Promise<ResultadoAgenda[]> {
  const res = await handler!(
    new Request("http://127.0.0.1:9999/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT, ...body }),
    }),
  );
  const json = await res.json() as { tenants: { agendas?: ResultadoAgenda[]; erro?: string }[] };
  return json.tenants?.[0]?.agendas ?? [];
}

// ─── Infra de asserção ───────────────────────────────────────────────────────

let falhas = 0;
let passou = 0;

function checar(condicao: boolean, mensagem: string): void {
  if (condicao) passou++;
  else { falhas++; console.error(`  ✗ ${mensagem}`); }
}

async function cenario(nome: string, fn: () => Promise<void>): Promise<void> {
  statusHttp = 200;
  statusRefresh = 200;
  refreshPedido = 0;
  tokensRecebidos = [];
  await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
  const antes = falhas;
  try {
    await fn();
  } catch (err) {
    falhas++;
    console.error(`  ✗ exceção em "${nome}": ${err instanceof Error ? err.message : err}`);
  }
  console.log(`${falhas === antes ? "✓" : "✗"} ${nome}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = "cccccccc-0000-4000-8000-0000000a0001";
const CRED_IB = "cccccccc-0000-4000-8000-0000000ac001";
const CRED_FP = "cccccccc-0000-4000-8000-0000000ac002";
const FILTRO_IB = "cccccccc-0000-4000-8000-0000000af001";
const FILTRO_FP = "cccccccc-0000-4000-8000-0000000af002";
const ARTISTA_IB = "Índio Behn - Dra. Rosangêla";

function futuro(dias: number, horaLocal = "21:00"): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${horaLocal}:00-03:00`;
}

function show(over: Partial<ShowDoPainel> = {}): ShowDoPainel {
  return {
    id: crypto.randomUUID(),
    monday_item_id: `m-${crypto.randomUUID().slice(0, 8)}`,
    artista: "IB",
    elemento: "Como Ser Tóxica e Influenciar Pessoas",
    cidade: "Curitiba",
    estado: "PR",
    teatro: "Teatro Bom Jesus",
    data_hora: futuro(10),
    data_show: null,
    status_monday: "Vendendo",
    link_vendas: "https://exemplo.invalido/ingresso",
    ...over,
  };
}

await db.from("tenants").upsert({ id: TENANT, name: "Tenant agenda e2e", slug: `tenant-agenda-e2e` });
await db.from("whatsapp_cloud_credentials").upsert([
  { id: CRED_IB, tenant_id: TENANT, waba_id: "waba-e2e", phone_number_id: "PN_AG_IB", access_token: "t", artista: ARTISTA_IB },
  { id: CRED_FP, tenant_id: TENANT, waba_id: "waba-e2e", phone_number_id: "PN_AG_FP", access_token: "t", artista: "Fábio Porchat" },
]);
await db.from("agenda_filtros").upsert([
  { id: FILTRO_IB, tenant_id: TENANT, cloud_credential_id: CRED_IB, artista_origem: "IB" },
  { id: FILTRO_FP, tenant_id: TENANT, cloud_credential_id: CRED_FP, artista_origem: "FP" },
]);
await db.from("agenda_conexoes").upsert({
  tenant_id: TENANT,
  base_url: `http://127.0.0.1:${STUB_PORT}`,
  token: "token-do-painel",
});

async function linhas(filtroId = FILTRO_IB) {
  const { data } = await db
    .from("agenda_shows_sync")
    .select("show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra")
    .eq("filtro_id", filtroId)
    .order("data_show");
  return data ?? [];
}

// ─── Cenários ────────────────────────────────────────────────────────────────

await cenario("o que o board tem de interno nunca chega ao fã", async () => {
  servir = [
    show({ monday_item_id: "ib-1" }),
    show({ monday_item_id: "bloq", status_monday: "Bloqueio", teatro: null, cidade: null, estado: null }),
    show({ monday_item_id: "corp", status_monday: "Corporativo" }),
    show({ monday_item_id: "pauta", status_monday: "Pauta" }),
    show({ monday_item_id: "aguard", status_monday: "Aguardando" }),
    show({ monday_item_id: "cancel", status_monday: "Cancelado" }),
    show({ monday_item_id: "outro-artista", artista: "DA" }),
  ];

  const [ib] = await sincronizar();
  checar(ib.inseridos === 1, `só o show Vendendo deveria entrar, inseridos=${ib.inseridos}`);
  checar(ib.ignorados?.status === 5, `5 status fora da allowlist, veio ${ib.ignorados?.status}`);
  checar(ib.ignorados?.artista === 1, `show de outro artista é ignorado, veio ${ib.ignorados?.artista}`);

  const rows = await linhas();
  checar(rows.length === 1 && rows[0].show_id_origem === "ib-1", "só ib-1 na agenda do fã");
});

await cenario("o fã recebe cidade/UF, teatro, horário e link", async () => {
  servir = [show({ monday_item_id: "ib-2", data_hora: futuro(5, "20:15") })];
  await sincronizar();
  const [row] = await linhas();
  checar(row.cidade === "Curitiba/PR", `cidade deveria unir cidade e estado, veio ${row.cidade}`);
  checar(row.teatro === "Teatro Bom Jesus", "teatro vem do board");
  checar(row.link_compra === "https://exemplo.invalido/ingresso", "link de compra vem do board");
  checar(row.status_venda === "à venda", `"Vendendo" tem que virar "à venda" para o fã, veio ${row.status_venda}`);
  // O horário é o que separa duas sessões do mesmo dia — perder isso funde as duas.
  checar(
    new Date(row.data_show!).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) === "20:15",
    `o horário local deveria ser 20:15, veio ${row.data_show}`,
  );
});

await cenario("duas sessões no mesmo dia e teatro são dois shows", async () => {
  servir = [
    show({ monday_item_id: "ses-1", data_hora: futuro(7, "18:00") }),
    show({ monday_item_id: "ses-2", data_hora: futuro(7, "20:15") }),
  ];
  await sincronizar();
  const rows = await linhas();
  checar(rows.length === 2, `as duas sessões deveriam virar duas linhas, veio ${rows.length}`);
  checar(new Set(rows.map((r) => r.data_show)).size === 2, "com horários distintos");
});

await cenario("show que sai do board sai da agenda do fã", async () => {
  servir = [show({ monday_item_id: "fica" }), show({ monday_item_id: "sai" })];
  await sincronizar();
  checar((await linhas()).length === 2, "as duas entram na primeira rodada");

  // Cancelou: deixa de ser elegível. A lista do Flow não filtra status, então
  // continuar aqui é continuar visível.
  servir = [show({ monday_item_id: "fica" }), show({ monday_item_id: "sai", status_monday: "Cancelado" })];
  const [ib] = await sincronizar();
  checar(ib.removidos === 1, `o cancelado deveria sair, removidos=${ib.removidos}`);
  const rows = await linhas();
  checar(rows.length === 1 && rows[0].show_id_origem === "fica", "só o que segue vendendo permanece");
});

await cenario("rodar duas vezes não duplica nem muda nada", async () => {
  servir = [show({ monday_item_id: "idem" })];
  await sincronizar();
  const [segunda] = await sincronizar();
  checar(segunda.inseridos === 0, `nada novo na segunda rodada, veio ${segunda.inseridos}`);
  checar(segunda.atualizados === 1, `um atualizado, veio ${segunda.atualizados}`);
  checar((await linhas()).length === 1, "segue com uma linha só");
});

await cenario("show que já passou não entra", async () => {
  servir = [show({ monday_item_id: "passado", data_hora: futuro(-3) }), show({ monday_item_id: "futuro" })];
  const [ib] = await sincronizar();
  checar(ib.ignorados?.passado === 1, `show passado é ignorado, veio ${ib.ignorados?.passado}`);
  checar((await linhas()).length === 1, "só o futuro entra");
});

await cenario("filtro de espetáculo, para central de um show só", async () => {
  await db.from("agenda_filtros").update({ espetaculos: ["Especial de Natal"] }).eq("id", FILTRO_IB);
  servir = [
    show({ monday_item_id: "natal", elemento: "Especial de Natal" }),
    show({ monday_item_id: "toxica", elemento: "Como Ser Tóxica e Influenciar Pessoas" }),
  ];
  const [ib] = await sincronizar();
  await db.from("agenda_filtros").update({ espetaculos: null }).eq("id", FILTRO_IB);

  checar(ib.inseridos === 1, `só o espetáculo filtrado entra, veio ${ib.inseridos}`);
  checar(ib.ignorados?.espetaculo === 1, "o outro é contado como ignorado");
});

await cenario("janela de dias limita o horizonte", async () => {
  await db.from("agenda_filtros").update({ janela_dias: 30 }).eq("id", FILTRO_IB);
  servir = [show({ monday_item_id: "perto", data_hora: futuro(10) }), show({ monday_item_id: "longe", data_hora: futuro(90) })];
  const [ib] = await sincronizar();
  await db.from("agenda_filtros").update({ janela_dias: null }).eq("id", FILTRO_IB);

  checar(ib.inseridos === 1, `só o show dentro da janela entra, veio ${ib.inseridos}`);
  checar(ib.ignorados?.fora_da_janela === 1, "o de fora é contado");
});

await cenario("rótulo com acento/caixa diferente ainda casa", async () => {
  servir = [show({ monday_item_id: "caixa", status_monday: "VENDENDO", artista: "ib" })];
  const [ib] = await sincronizar();
  checar(ib.inseridos === 1, `comparação sem caixa/acento deveria casar, veio ${ib.inseridos}`);
});

await cenario("painel fora do ar NÃO apaga a agenda que está no ar", async () => {
  servir = [show({ monday_item_id: "no-ar" })];
  await sincronizar();
  checar((await linhas()).length === 1, "agenda publicada antes da falha");

  statusHttp = 500;
  const agendas = await sincronizar();
  checar(agendas.length === 0, "com o painel fora do ar, nenhuma agenda é processada");
  checar((await linhas()).length === 1, "a agenda anterior continua no ar — falha de rede não é 'nenhum show'");

  const { data: eventos } = await db
    .from("events_log")
    .select("event_type, error")
    .eq("tenant_id", TENANT)
    .eq("event_type", "agenda_sync_erro")
    .order("created_at", { ascending: false })
    .limit(1);
  checar((eventos ?? []).length === 1, "a falha precisa ficar registrada em events_log");
});

await cenario("agenda que ficou vazia gera evento próprio", async () => {
  servir = [show({ monday_item_id: "so-bloqueio", status_monday: "Bloqueio" })];
  await sincronizar();
  const { data: eventos } = await db
    .from("events_log")
    .select("event_type, payload")
    .eq("tenant_id", TENANT)
    .eq("event_type", "agenda_sync_vazia")
    .order("created_at", { ascending: false })
    .limit(1);
  checar((eventos ?? []).length === 1, "agenda vazia é o defeito mais silencioso — precisa de evento");
});

await cenario("cada agenda recebe só o seu artista, e grava o nome da credencial", async () => {
  servir = [show({ monday_item_id: "do-ib", artista: "IB" }), show({ monday_item_id: "do-fp", artista: "FP" })];
  await sincronizar({ tenantId: TENANT });

  const doIb = await linhas(FILTRO_IB);
  const doFp = await linhas(FILTRO_FP);
  checar(doIb.length === 1 && doIb[0].show_id_origem === "do-ib", "IB recebe só o show do IB");
  checar(doFp.length === 1 && doFp[0].show_id_origem === "do-fp", "FP recebe só o show do FP");
  checar(doIb[0].artista === ARTISTA_IB, `o nome gravado vem da credencial, veio ${doIb[0].artista}`);
  checar(doFp[0].artista === "Fábio Porchat", "cada número grava o artista dele");
  await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
});

await cenario("o token do painel vai no Authorization, e só o futuro é pedido", async () => {
  servir = [show()];
  await sincronizar();
  checar(tokensRecebidos[0] === "Bearer token-do-painel", `token deveria ir no header, veio "${tokensRecebidos[0]}"`);
  checar(desdeRecebido === new Date().toISOString().slice(0, 10), `desde deveria ser hoje, veio ${desdeRecebido}`);
});

await cenario("sem hora o show entra com a data, sem inventar horário", async () => {
  servir = [show({ monday_item_id: "sem-hora", data_hora: null, data_show: futuro(12).slice(0, 10) })];
  await sincronizar();
  const [row] = await linhas();
  checar(!!row, "show sem hora ainda precisa aparecer na agenda");
  const horaLocal = new Date(row.data_show!).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
  });
  checar(horaLocal === "00:00", `sem hora vira meia-noite local (lida como "a confirmar"), veio ${horaLocal}`);
});

await cenario("pede ao painel que releia o board antes de ler o espelho", async () => {
  servir = [show()];
  await sincronizar();
  checar(refreshPedido === 1, `deveria pedir a atualização do espelho, pediu ${refreshPedido}`);
});

await cenario("espelho que não atualizou não impede a sincronização", async () => {
  // O board pode estar inacessível (OAuth expirado lá, por exemplo) e o
  // espelho anterior continuar válido. Ficar sem agenda seria pior.
  servir = [show({ monday_item_id: "com-espelho-velho" })];
  statusRefresh = 500;
  const [ib] = await sincronizar();
  checar(ib?.inseridos === 1, `deveria sincronizar com o espelho atual, veio ${ib?.inseridos}`);

  const { data: eventos } = await db
    .from("events_log")
    .select("event_type")
    .eq("tenant_id", TENANT)
    .eq("event_type", "agenda_espelho_nao_atualizado")
    .limit(1);
  checar((eventos ?? []).length === 1, "a falha de atualização precisa ficar registrada");
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
await db.from("events_log").delete().eq("tenant_id", TENANT);
await db.from("agenda_filtros").delete().in("id", [FILTRO_IB, FILTRO_FP]);
await db.from("agenda_conexoes").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_cloud_credentials").delete().in("id", [CRED_IB, CRED_FP]);
await db.from("tenants").delete().eq("id", TENANT);
await stub.shutdown();

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
