// Teste do registro de custo por disparo no whatsapp-cloud-webhook.
//
// A Meta manda o objeto `pricing` uma única vez, junto do primeiro status —
// não há como recuperá-lo depois. Antes desta trilha o webhook descartava
// isso por inteiro, e ainda saía cedo quando o wamid não era de campanha,
// que é o caso de toda resposta automática de Flow e de todo envio manual
// pelo painel: justamente o que passa a ser cobrado em 01/10/2026.
//
// COMO RODAR: `npm run test:db` com o Supabase local de pé. Nada sai para a Meta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(DB_URL, SERVICE_KEY);

const SEGREDO = "segredo-de-teste-custos";
const WABA = "WABA_CUSTOS_TESTE";
const PN = "PN_CUSTOS_TESTE";
const TENANT = "dddddddd-0000-4000-8000-00000000c001";
const CRED = "dddddddd-0000-4000-8000-00000000c002";
const SESSAO = "dddddddd-0000-4000-8000-00000000c003";
const CAMPANHA = "dddddddd-0000-4000-8000-00000000c004";

const WAMID_CAMPANHA = "wamid.TESTE_CUSTOS_CAMPANHA";
const WAMID_FLOW = "wamid.TESTE_CUSTOS_FLOW";
const TELEFONE = "5541900000123";

// Disparo datado depois de 01/07/2026 (rate card BRL vigente) e antes da
// virada de 01/10 — é o cenário que a tarifa congelada precisa refletir.
const TS_ENVIO = Math.floor(new Date("2026-08-15T12:00:00Z").getTime() / 1000);

Deno.env.set("SUPABASE_URL", DB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("META_APP_SECRET", SEGREDO);
Deno.env.set("META_WEBHOOK_VERIFY_TOKEN", "verify-de-teste");

const serveOriginal = Deno.serve;
let handler: ((req: Request) => Promise<Response> | Response) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => {
  handler = typeof h === "function" ? h : h.handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};
await import(new URL("../functions/whatsapp-cloud-webhook/index.ts", import.meta.url).href);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = serveOriginal;
if (!handler) throw new Error("whatsapp-cloud-webhook não registrou handler");

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

async function enviar(corpo: unknown): Promise<Response> {
  const cru = JSON.stringify(corpo);
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SEGREDO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(cru));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const res = await handler!(new Request("http://local/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${hex}` },
    body: cru,
  }));
  // O webhook responde 200 e processa em segundo plano — dar tempo ao insert.
  await new Promise((r) => setTimeout(r, 900));
  return res;
}

/** Envelope de status de entrega, no formato que a Meta manda. */
function statusEnvelope(status: {
  id: string;
  status: string;
  pricing?: Record<string, unknown>;
  timestamp?: number;
}) {
  return {
    entry: [{
      id: WABA,
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: PN },
          statuses: [{
            id: status.id,
            status: status.status,
            timestamp: String(status.timestamp ?? TS_ENVIO),
            recipient_id: TELEFONE,
            ...(status.pricing ? { pricing: status.pricing } : {}),
          }],
        },
      }],
    }],
  };
}

interface LinhaCusto {
  wamid: string;
  tenant_id: string;
  session_id: string | null;
  campaign_id: string | null;
  billable: boolean;
  pricing_type: string | null;
  pricing_category: string | null;
  rate_amount: number;
  country_code: string | null;
}

async function custo(wamid: string): Promise<LinhaCusto | null> {
  const { data } = await db.from("whatsapp_message_costs")
    .select("wamid, tenant_id, session_id, campaign_id, billable, pricing_type, pricing_category, rate_amount, country_code")
    .eq("wamid", wamid).maybeSingle<LinhaCusto>();
  return data ?? null;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

await db.from("whatsapp_message_costs").delete().eq("tenant_id", TENANT);
await db.from("tenants").upsert({ id: TENANT, name: "Tenant custos", slug: "tenant-custos-e2e" });
await db.from("whatsapp_cloud_credentials").upsert({
  id: CRED, tenant_id: TENANT, waba_id: WABA, phone_number_id: PN, access_token: "tok", active: true,
});
await db.from("wa_sessions").upsert({
  id: SESSAO, tenant_id: TENANT, phone_number: "+5541900000999",
  channel: "cloud_api", cloud_credential_id: CRED,
});
await db.from("campaigns").upsert({
  id: CAMPANHA, tenant_id: TENANT, credential_id: CRED, name: "Campanha custos e2e",
  template_name: "tmpl_custos", template_language: "pt_BR", template_category: "MARKETING",
  status: "sending", total_recipients: 1,
});
await db.from("campaign_recipients").upsert({
  campaign_id: CAMPANHA, tenant_id: TENANT, phone_e164: TELEFONE,
  status: "sent", wamid: WAMID_CAMPANHA,
}, { onConflict: "campaign_id,phone_e164" });
await db.from("events_log").delete().eq("tenant_id", TENANT);

// ─── Cenários ────────────────────────────────────────────────────────────────

await cenario("status de campanha com `pricing` vira linha de custo com a tarifa congelada", async () => {
  await enviar(statusEnvelope({
    id: WAMID_CAMPANHA,
    status: "sent",
    pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" },
  }));

  const linha = await custo(WAMID_CAMPANHA);
  checar(linha !== null, "deveria ter criado a linha de custo");
  if (!linha) return;
  checar(Number(linha.rate_amount) === 0.3217,
    `marketing BR deveria custar 0,3217; veio ${linha.rate_amount}`);
  checar(linha.campaign_id === CAMPANHA, "a linha deveria apontar para a campanha");
  checar(linha.session_id === SESSAO, `session_id deveria ser resolvido pelo phone_number_id; veio ${linha.session_id}`);
  checar(linha.billable === true, "marketing é sempre cobrada");
  checar(linha.country_code === "BR", `country_code deveria ser BR; veio ${linha.country_code}`);
});

await cenario("o MESMO wamid chegando de novo (delivered) não duplica nem reescreve o valor", async () => {
  // A Meta reentrega status e manda `pricing` de novo. Se o segundo evento
  // sobrescrevesse, um reajuste de rate card entre um e outro reescreveria
  // história de faturamento.
  await enviar(statusEnvelope({
    id: WAMID_CAMPANHA,
    status: "delivered",
    // Categoria propositalmente diferente: se o upsert não estiver
    // ignorando duplicata, a linha vira utility (0,0350) e o teste pega.
    pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "utility" },
    timestamp: TS_ENVIO + 60,
  }));

  const { count } = await db.from("whatsapp_message_costs")
    .select("id", { count: "exact", head: true }).eq("wamid", WAMID_CAMPANHA);
  checar((count ?? 0) === 1, `deveria continuar com 1 linha; tem ${count}`);

  const linha = await custo(WAMID_CAMPANHA);
  checar(linha?.pricing_category === "marketing",
    `a categoria original deveria ser preservada; veio ${linha?.pricing_category}`);
  checar(Number(linha?.rate_amount) === 0.3217,
    `o valor congelado deveria ser preservado; veio ${linha?.rate_amount}`);

  // E o status de entrega continua funcionando como antes.
  const { data: dest } = await db.from("campaign_recipients")
    .select("status").eq("wamid", WAMID_CAMPANHA).maybeSingle<{ status: string }>();
  checar(dest?.status === "delivered", `o destinatário deveria estar delivered; veio ${dest?.status}`);
});

await cenario("mensagem FORA de campanha (Flow/envio manual) também vira linha de custo", async () => {
  // Nenhuma linha em campaign_recipients para este wamid — é exatamente o
  // caso em que o webhook saía cedo e o custo se perdia.
  await enviar(statusEnvelope({
    id: WAMID_FLOW,
    status: "sent",
    pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" },
  }));

  const linha = await custo(WAMID_FLOW);
  checar(linha !== null, "resposta automática/envio manual deveria gerar linha de custo");
  if (!linha) return;
  checar(linha.campaign_id === null, "não é de campanha, campaign_id deve ser null");
  checar(linha.tenant_id === TENANT, "o tenant deveria ser resolvido pelo phone_number_id");
  checar(linha.session_id === SESSAO, `session_id deveria ser resolvido pelo phone_number_id; veio ${linha.session_id}`);
  checar(linha.billable === false, "dentro da janela de 24h ainda é grátis (até 01/10/2026)");
  checar(Number(linha.rate_amount) === 0, "mensagem grátis entra com valor zero, mas a linha existe");
  checar(linha.pricing_type === "free_customer_service", `pricing_type veio ${linha.pricing_type}`);
});

await cenario("status SEM `pricing` não inventa linha de custo", async () => {
  await enviar(statusEnvelope({ id: "wamid.TESTE_CUSTOS_SEM_PRICING", status: "read" }));
  const linha = await custo("wamid.TESTE_CUSTOS_SEM_PRICING");
  checar(linha === null, "sem informação de cobrança da Meta, não há o que registrar");
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("whatsapp_message_costs").delete().eq("tenant_id", TENANT);
await db.from("campaign_recipients").delete().eq("tenant_id", TENANT);
await db.from("campaigns").delete().eq("id", CAMPANHA);
await db.from("events_log").delete().eq("tenant_id", TENANT);
await db.from("wa_sessions").delete().eq("id", SESSAO);
await db.from("whatsapp_cloud_credentials").delete().eq("id", CRED);
await db.from("tenants").delete().eq("id", TENANT);

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
