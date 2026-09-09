// Consultas que o PAINEL faz, exercitadas contra o PostgREST de verdade.
//
// Por que este arquivo existe: em 09/09/2026 a tela de Automações mostrou
// "Nenhuma automação criada ainda" com três Flows no banco. A causa era
// PGRST201 — `flow_palavras_chave` tem DUAS chaves estrangeiras para
// `whatsapp_flows` (flow_id e flow_destino_id), e o embed sem nomear a FK é
// ambíguo. O bug entrou com a migration 0025 e sobreviveu porque:
//   - nenhum teste exercitava as consultas do painel,
//   - a tela adiciona o Flow recém-criado na lista sem recarregar, então
//     parecia funcionar até alguém dar refresh.
//
// Aqui não se testa a rota HTTP (o projeto não tem infra para isso) — testa-se
// a CONSULTA, que é onde a falha estava. Se um select do painel mudar, o
// equivalente aqui precisa mudar junto.
//
// COMO RODAR: `npm run test:db` com o Supabase local de pé.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(DB_URL, SERVICE_KEY);

const TENANT = "eeeeeeee-0000-4000-8000-00000000a001";
const CRED = "eeeeeeee-0000-4000-8000-00000000a002";
const FLOW = "eeeeeeee-0000-4000-8000-00000000a003";
const DESTINO = "eeeeeeee-0000-4000-8000-00000000a004";

let falhas = 0;
let passou = 0;
function checar(cond: boolean, msg: string) {
  if (cond) passou++;
  else { falhas++; console.error(`  ✗ ${msg}`); }
}
async function cenario(nome: string, fn: () => Promise<void>) {
  const antes = falhas;
  try { await fn(); } catch (err) {
    falhas++;
    console.error(`  ✗ exceção em "${nome}": ${err instanceof Error ? err.message : err}`);
  }
  console.log(`${falhas === antes ? "✓" : "✗"} ${nome}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

await db.from("tenants").upsert({ id: TENANT, name: "Tenant painel", slug: "tenant-painel-teste" });
await db.from("whatsapp_cloud_credentials").upsert({
  id: CRED, tenant_id: TENANT, waba_id: "WABA_PAINEL", phone_number_id: "PN_PAINEL",
  access_token: "tok", active: true, artista: "Artista Painel",
});
await db.from("whatsapp_flows").upsert([
  {
    id: DESTINO, tenant_id: TENANT, cloud_credential_id: CRED, nome: "Central",
    tipo: "central", ativo: true, meta_flow_id: "META_PAINEL", mensagem_fallback: "fb",
  },
  {
    id: FLOW, tenant_id: TENANT, cloud_credential_id: CRED, nome: "Palavras-chave",
    tipo: "keyword_automation", ativo: false, meta_flow_id: null, mensagem_fallback: "fb",
  },
]);
await db.from("flow_palavras_chave").delete().eq("tenant_id", TENANT);
await db.from("flow_palavras_chave").insert([
  {
    tenant_id: TENANT, flow_id: FLOW, palavra_chave: "ingresso",
    tipo_resposta: "link", resposta: "https://exemplo.invalido", flow_destino_id: null,
  },
  {
    tenant_id: TENANT, flow_id: FLOW, palavra_chave: "menu",
    tipo_resposta: "abrir_flow", resposta: null, flow_destino_id: DESTINO,
  },
]);

// ─── Cenários ────────────────────────────────────────────────────────────────

await cenario("lista de Flows com as palavras-chave embutidas (PGRST201)", async () => {
  const { data, error } = await db
    .from("whatsapp_flows")
    .select("id, cloud_credential_id, artista, nome, tipo, ativo, meta_flow_id, mensagem_boas_vindas, mensagem_fallback, created_at, flow_palavras_chave!flow_palavras_chave_flow_id_fkey(id, palavra_chave, tipo_resposta, resposta, flow_destino_id, deleted_at)")
    .eq("tenant_id", TENANT)
    .is("deleted_at", null);

  checar(!error, `a consulta da lista não pode falhar: ${error?.message}`);
  checar((data ?? []).length === 2, `deveria trazer os 2 Flows, veio ${(data ?? []).length}`);

  const comKeywords = (data ?? []).find((f) => f.id === FLOW);
  const keywords = (comKeywords?.flow_palavras_chave ?? []) as { palavra_chave: string }[];
  checar(keywords.length === 2, `o Flow deveria trazer suas 2 palavras-chave, veio ${keywords.length}`);
  checar(
    keywords.some((k) => k.palavra_chave === "menu"),
    "o embed precisa vir pela FK flow_id — a keyword que APONTA para o destino é dele, não do destino",
  );

  // A prova de que a FK certa foi usada: o Flow de destino não pode "receber"
  // a keyword que aponta para ele.
  const destino = (data ?? []).find((f) => f.id === DESTINO);
  checar(
    ((destino?.flow_palavras_chave ?? []) as unknown[]).length === 0,
    "o Flow de destino não pode aparecer com a keyword que o referencia",
  );
});

await cenario("embed sem nomear a FK é ambíguo e falha (é o bug que houve)", async () => {
  const { error } = await db
    .from("whatsapp_flows")
    .select("id, flow_palavras_chave(id)")
    .eq("tenant_id", TENANT);

  checar(Boolean(error), "o embed ambíguo PRECISA falhar — se parar de falhar, o alerta aqui perde sentido");
  checar(
    error?.code === "PGRST201",
    `o erro esperado é PGRST201 (relacionamento ambíguo), veio ${error?.code}`,
  );
});

await cenario("checagem de ativação lê as palavras-chave do próprio Flow", async () => {
  const { data, error } = await db
    .from("whatsapp_flows")
    .select("mensagem_fallback, flow_palavras_chave!flow_palavras_chave_flow_id_fkey(id, deleted_at)")
    .eq("id", FLOW)
    .is("deleted_at", null)
    .maybeSingle();

  checar(!error, `a consulta de ativação não pode falhar: ${error?.message}`);
  const keywords = ((data?.flow_palavras_chave ?? []) as { deleted_at: string | null }[])
    .filter((k) => k.deleted_at === null);
  checar(keywords.length === 2, `deveria enxergar 2 keywords para liberar a ativação, veio ${keywords.length}`);
});

await cenario("destinos oferecidos para abrir_flow: publicados e do mesmo número", async () => {
  const { data } = await db
    .from("whatsapp_flows")
    .select("id, nome, tipo, ativo, meta_flow_id, cloud_credential_id")
    .eq("tenant_id", TENANT)
    .is("deleted_at", null);

  const destinos = (data ?? []).filter((f) => f.meta_flow_id && f.ativo);
  checar(destinos.length === 1, `só o Flow publicado pode ser destino, veio ${destinos.length}`);
  checar(destinos[0]?.id === DESTINO, "o destino deveria ser a central publicada");
});

await cenario("palavra-chave não pode ser cadastrada em Flow de central/agenda", async () => {
  const { error } = await db.from("flow_palavras_chave").insert({
    tenant_id: TENANT, flow_id: DESTINO, palavra_chave: "solta",
    tipo_resposta: "texto", resposta: "nunca dispararia",
  });
  checar(Boolean(error), "o banco precisa recusar keyword em Flow que não é de palavra-chave");
  checar(
    (error?.message ?? "").includes("palavra-chave só pode pertencer"),
    `mensagem inesperada: ${error?.message}`,
  );
});

await cenario("a tela separa automações de Flows publicados", async () => {
  const { data } = await db
    .from("whatsapp_flows")
    .select("id, nome, tipo, ativo, meta_flow_id")
    .eq("tenant_id", TENANT)
    .is("deleted_at", null);

  const automacoes = (data ?? []).filter((f) => f.tipo === "keyword_automation");
  const publicados = (data ?? []).filter((f) => f.tipo !== "keyword_automation");
  checar(automacoes.length === 1, `1 automação esperada, veio ${automacoes.length}`);
  checar(publicados.length === 1, `1 Flow publicado esperado, veio ${publicados.length}`);
  checar(publicados[0]?.tipo === "central", "o Flow publicado é a central");
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("flow_palavras_chave").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_flows").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_cloud_credentials").delete().eq("id", CRED);
await db.from("tenants").delete().eq("id", TENANT);

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
