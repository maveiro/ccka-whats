// Teste dos campos de webhook além de `messages` (09/09/2026).
//
// A WABA passou a assinar account_alerts, flows, history, message_handovers,
// tracking_events e user_preferences. Antes disso o webhook descartava em
// silêncio tudo que não fosse `messages` — inclusive erro de Flow no aparelho,
// que foi o que faltou durante a validação da Trilha B, e a preferência de
// opt-out do próprio usuário, que é compliance.
//
// COMO RODAR: `npm run test:db` com o Supabase local de pé. Nada sai para a Meta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(DB_URL, SERVICE_KEY);

const SEGREDO = "segredo-de-teste-webhook";
const WABA = "WABA_WEBHOOK_TESTE";
const PN = "PN_WEBHOOK_TESTE";
const TENANT = "dddddddd-0000-4000-8000-00000000e001";
const CRED = "dddddddd-0000-4000-8000-00000000e002";
const TELEFONE = "5541900000001";

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

/** Assina como a Meta assina (HMAC-SHA256 do corpo cru). */
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

function envelope(field: string, value: unknown) {
  return { entry: [{ id: WABA, changes: [{ field, value }] }] };
}

async function eventos(tipo: string): Promise<number> {
  const { count } = await db.from("events_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("event_type", tipo);
  return count ?? 0;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

await db.from("tenants").upsert({ id: TENANT, name: "Tenant webhook", slug: "tenant-webhook-teste" });
await db.from("whatsapp_cloud_credentials").upsert({
  id: CRED, tenant_id: TENANT, waba_id: WABA, phone_number_id: PN, access_token: "tok", active: true,
});
await db.from("whatsapp_opt_outs").delete().eq("tenant_id", TENANT);
await db.from("events_log").delete().eq("tenant_id", TENANT);

// ─── Cenários ────────────────────────────────────────────────────────────────

await cenario("assinatura inválida é recusada com 401", async () => {
  const res = await handler!(new Request("http://local/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=00" },
    body: JSON.stringify(envelope("flows", {})),
  }));
  checar(res.status === 401, `deveria ser 401, veio ${res.status}`);
});

await cenario("campo `flows` vira evento com o motivo do erro do cliente", async () => {
  await enviar(envelope("flows", {
    event: "FLOW_STATUS_CHANGE",
    message: "endpoint unavailable",
    flow_id: "1058927487016703",
  }));
  checar(await eventos("flow_client_report") === 1, "deveria registrar flow_client_report");
  const { data } = await db.from("events_log").select("payload")
    .eq("tenant_id", TENANT).eq("event_type", "flow_client_report").limit(1).single();
  const p = (data?.payload ?? {}) as Record<string, unknown>;
  checar(p.message === "endpoint unavailable", `o motivo precisa ser preservado, veio ${JSON.stringify(p)}`);
});

await cenario("user_preferences 'stop' cria opt-out (o flow-engine já respeita)", async () => {
  await enviar(envelope("user_preferences", {
    metadata: { phone_number_id: PN },
    user_preferences: [{ wa_id: TELEFONE, detail: "user asked to stop", category: "marketing_messages", value: "stop" }],
  }));

  const { count } = await db.from("whatsapp_opt_outs").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("phone_e164", TELEFONE);
  checar((count ?? 0) === 1, "deveria ter criado a linha de opt-out");
  checar(await eventos("opt_out_pelo_usuario") === 1, "deveria registrar opt_out_pelo_usuario");
});

await cenario("'stop' repetido não duplica (a Meta reentrega webhook)", async () => {
  await enviar(envelope("user_preferences", {
    metadata: { phone_number_id: PN },
    user_preferences: [{ wa_id: TELEFONE, detail: "again", category: "marketing_messages", value: "stop" }],
  }));
  const { count } = await db.from("whatsapp_opt_outs").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("phone_e164", TELEFONE);
  checar((count ?? 0) === 1, `deveria continuar com 1 linha, tem ${count}`);
});

await cenario("'resume' remove o opt-out — consentimento explícito", async () => {
  await enviar(envelope("user_preferences", {
    metadata: { phone_number_id: PN },
    user_preferences: [{ wa_id: TELEFONE, category: "marketing_messages", value: "resume" }],
  }));
  const { count } = await db.from("whatsapp_opt_outs").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("phone_e164", TELEFONE);
  checar((count ?? 0) === 0, "opt-out deveria ter sido removido");
  checar(await eventos("opt_in_pelo_usuario") === 1, "deveria registrar opt_in_pelo_usuario");
});

await cenario("campo ainda não tratado é registrado, não descartado", async () => {
  await enviar(envelope("tracking_events", { qualquer: "coisa" }));
  const { count } = await db.from("events_log").select("id", { count: "exact", head: true })
    .eq("event_type", "webhook_campo_nao_tratado");
  checar((count ?? 0) >= 1, "campo desconhecido deveria virar evento");
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("events_log").delete().eq("event_type", "webhook_campo_nao_tratado").is("tenant_id", null);
await db.from("whatsapp_opt_outs").delete().eq("tenant_id", TENANT);
await db.from("events_log").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_cloud_credentials").delete().eq("id", CRED);
await db.from("tenants").delete().eq("id", TENANT);

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
