// Teste do endpoint de WhatsApp Flows (Sprint B1 — spike de criptografia).
//
// O cliente sintético abaixo faz EXATAMENTE o que o app do WhatsApp faz:
// gera uma chave AES-128 e um IV, cifra a AES com a nossa chave pública
// (RSA-OAEP/SHA-256), cifra o payload com AES-GCM, e depois abre a resposta
// com a mesma chave e o IV invertido. Se este teste passa, o formato está
// certo — o que o Playground da Meta valida em cima disso é a assinatura da
// chave pública e a conectividade, não o protocolo.
//
// COMO RODAR: `npm run test:db` (Supabase local de pé). Nada sai para a Meta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(DB_URL, SERVICE_KEY);

const PN = "PN_FLOW_ENDPOINT_TESTE";
const TENANT = "cccccccc-0000-4000-8000-00000000d001";
const CRED = "cccccccc-0000-4000-8000-00000000d002";

// ─── Sobe o endpoint no host (o edge runtime local não sobe worker aqui) ─────

Deno.env.set("SUPABASE_URL", DB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const serveOriginal = Deno.serve;
let handler: ((req: Request) => Promise<Response> | Response) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => {
  handler = typeof h === "function" ? h : h.handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};
await import(new URL("../functions/flow-endpoint/index.ts", import.meta.url).href);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = serveOriginal;
if (!handler) throw new Error("flow-endpoint não registrou handler");

// ─── Infra de asserção ───────────────────────────────────────────────────────

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

// ─── Cliente sintético (o papel do app do WhatsApp) ──────────────────────────

function b64(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function debase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pemParaDer(pem: string): Uint8Array {
  return debase64(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
}

async function gerarPar() {
  const par = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", par.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  const pem = (t: string, b: Uint8Array) =>
    `-----BEGIN ${t} KEY-----\n${b64(b).replace(/(.{64})/g, "$1\n").trimEnd()}\n-----END ${t} KEY-----`;
  return { publicaPem: pem("PUBLIC", spki), privadaPem: pem("PRIVATE", pkcs8) };
}

/** Monta a requisição como a Meta monta, e devolve o que precisa para abrir a resposta. */
async function pedir(publicaPem: string, payload: unknown) {
  const chavePublica = await crypto.subtle.importKey(
    "spki", pemParaDer(publicaPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
  );

  const chaveAesBytes = crypto.getRandomValues(new Uint8Array(16)); // AES-128, como a Meta
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const chaveAes = await crypto.subtle.importKey("raw", chaveAesBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 }, chaveAes, new TextEncoder().encode(JSON.stringify(payload)),
  ));
  const chaveCifrada = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, chavePublica, chaveAesBytes));

  const res = await handler!(new Request(`http://local/?phone_number_id=${PN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encrypted_flow_data: b64(cifrado),
      encrypted_aes_key: b64(chaveCifrada),
      initial_vector: b64(iv),
    }),
  }));

  return { res, chaveAes, iv };
}

/** Abre a resposta: mesma chave AES, IV invertido (XOR 0xFF). */
async function abrirResposta(res: Response, chaveAes: CryptoKey, iv: Uint8Array) {
  const texto = await res.text();
  const ivInvertido = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) ivInvertido[i] = iv[i] ^ 0xff;
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivInvertido, tagLength: 128 }, chaveAes, debase64(texto),
  );
  return JSON.parse(new TextDecoder().decode(claro)) as Record<string, unknown>;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const { publicaPem, privadaPem } = await gerarPar();

await db.from("tenants").upsert({ id: TENANT, name: "Tenant flow-endpoint", slug: "tenant-flow-endpoint" });
await db.from("whatsapp_cloud_credentials").upsert({
  id: CRED, tenant_id: TENANT, waba_id: "WABA_TESTE", phone_number_id: PN, access_token: "tok", active: true,
});
await db.from("internal_secrets").delete().eq("key", `flow_private_key:${PN}`);
await db.from("events_log").delete().eq("tenant_id", TENANT);

// ─── Cenários ────────────────────────────────────────────────────────────────

await cenario("sem chave configurada: 421 (contrato da Meta para 'não consegui abrir')", async () => {
  const { res } = await pedir(publicaPem, { version: "3.0", action: "ping" });
  checar(res.status === 421, `deveria ser 421, veio ${res.status}`);
  const { count } = await db.from("events_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("event_type", "flow_endpoint_sem_chave");
  checar((count ?? 0) === 1, "deveria registrar flow_endpoint_sem_chave");
});

// Configura a chave privada — daqui em diante o endpoint consegue abrir.
await db.from("internal_secrets").upsert({ key: `flow_private_key:${PN}`, value: privadaPem });

await cenario("health check: ping responde {status: active} cifrado", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "3.0", action: "ping" });
  checar(res.status === 200, `deveria ser 200, veio ${res.status}`);
  checar(res.headers.get("Content-Type")?.includes("text/plain") ?? false, "resposta deve ser texto puro (base64)");

  const corpo = await abrirResposta(res, chaveAes, iv);
  checar(
    JSON.stringify(corpo) === JSON.stringify({ data: { status: "active" } }),
    `payload inesperado: ${JSON.stringify(corpo)}`,
  );
});

await cenario("resposta usa o IV INVERTIDO, não o mesmo IV", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "3.0", action: "ping" });
  const texto = await res.text();

  // Com o IV original a decriptação tem que falhar — se passasse, estaríamos
  // reusando (chave, IV), o que quebra o GCM por completo.
  let abriuComIvOriginal = false;
  try {
    await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, chaveAes, debase64(texto));
    abriuComIvOriginal = true;
  } catch { /* esperado */ }
  checar(!abriuComIvOriginal, "a resposta NÃO pode abrir com o IV original (reuso de chave+IV)");

  const ivInvertido = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) ivInvertido[i] = iv[i] ^ 0xff;
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivInvertido, tagLength: 128 }, chaveAes, debase64(texto));
  checar(JSON.parse(new TextDecoder().decode(claro)).data.status === "active", "com o IV invertido deve abrir");
});

await cenario("erro relatado pelo cliente é reconhecido e fica visível", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "3.0",
    action: "data_exchange",
    flow_token: "tok-teste",
    data: { error: "public-key-missing", error_message: "chave ausente" },
  });
  const corpo = await abrirResposta(res, chaveAes, iv);
  checar(
    JSON.stringify(corpo) === JSON.stringify({ data: { acknowledged: true } }),
    `deveria reconhecer o erro, veio ${JSON.stringify(corpo)}`,
  );

  const { data } = await db.from("events_log").select("payload")
    .eq("tenant_id", TENANT).eq("event_type", "flow_endpoint_erro_do_cliente").limit(1).single();
  const p = (data?.payload ?? {}) as Record<string, unknown>;
  checar(p.error === "public-key-missing", "o erro do cliente precisa ficar registrado — é o sinal de reenviar a chave");
});

await cenario("chave errada: 421, não 500 nem 200", async () => {
  const outro = await gerarPar(); // cliente cifra com uma pública que não é a nossa
  const { res } = await pedir(outro.publicaPem, { version: "3.0", action: "ping" });
  checar(res.status === 421, `deveria ser 421, veio ${res.status}`);
});

await cenario("payload malformado é 400, não 421 (não faz a Meta rotacionar chave à toa)", async () => {
  const res = await handler!(new Request(`http://local/?phone_number_id=${PN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_flow_data: "x" }), // faltam campos
  }));
  checar(res.status === 400, `deveria ser 400, veio ${res.status}`);

  const semQuery = await handler!(new Request("http://local/", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  checar(semQuery.status === 400, `sem phone_number_id deveria ser 400, veio ${semQuery.status}`);
});

await cenario("ação de tela ainda não implementada é reconhecida e registrada (B2)", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "3.0", action: "INIT", screen: "AGENDA", data: {},
  });
  const corpo = await abrirResposta(res, chaveAes, iv);
  checar(
    JSON.stringify(corpo) === JSON.stringify({ data: { acknowledged: true } }),
    `deveria reconhecer, veio ${JSON.stringify(corpo)}`,
  );
  const { count } = await db.from("events_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT).eq("event_type", "flow_endpoint_acao_nao_implementada");
  checar((count ?? 0) >= 1, "ação não implementada deve ficar registrada");
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("internal_secrets").delete().eq("key", `flow_private_key:${PN}`);
await db.from("events_log").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_cloud_credentials").delete().eq("id", CRED);
await db.from("tenants").delete().eq("id", TENANT);

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
