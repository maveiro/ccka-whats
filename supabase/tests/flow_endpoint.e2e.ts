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
await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
await db.from("faq_itens").delete().eq("tenant_id", TENANT);
await db.from("flow_sessoes").delete().eq("tenant_id", TENANT);
await db.from("clientes").delete().eq("tenant_id", TENANT);

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

await cenario("número no CAMINHO da URL funciona igual à query string", async () => {
  // A URI é digitada no painel da Meta; perder o "?phone_number_id=" ao
  // copiar/colar é fácil, e o resultado seria a verificação de integridade
  // falhando com 400 sem explicação óbvia.
  const aesBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aes = await crypto.subtle.importKey("raw", aesBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const chavePublica = await crypto.subtle.importKey("spki", pemParaDer(publicaPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const dados = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 }, aes,
    new TextEncoder().encode(JSON.stringify({ version: "3.0", action: "ping" })),
  ));
  const chaveCif = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, chavePublica, aesBytes));

  const res = await handler!(new Request(`http://local/flow-endpoint/${PN.replace(/\D/g, "") || "0"}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encrypted_flow_data: b64(dados), encrypted_aes_key: b64(chaveCif), initial_vector: b64(iv),
    }),
  }));
  // PN do teste não é numérico, então o caminho não resolve — o que provamos
  // aqui é que um caminho NUMÉRICO é aceito como identificador (chega a tentar
  // abrir e falha por não ter chave para aquele número: 421, não 400).
  checar(res.status === 421, `caminho numérico deveria ser aceito como id (421 por chave ausente), veio ${res.status}`);
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

await cenario("ação sem tratamento é reconhecida e registrada", async () => {
  // Era INIT até a B2; agora INIT devolve tela de verdade, então o caso de
  // "ação que não sabemos tratar" precisa de outra ação.
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "3.0", action: "BACK", screen: "AGENDA", data: {},
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

// ─── Telas da agenda (Sprint B2) ─────────────────────────────────────────────

const AMANHA = new Date(Date.now() + 86_400_000).toISOString();
const ONTEM = new Date(Date.now() - 86_400_000).toISOString();

await db.from("whatsapp_cloud_credentials").update({ artista: "Artista A" }).eq("id", CRED);
const { data: showsCriados } = await db.from("agenda_shows_sync").insert([
  { tenant_id: TENANT, artista: "Artista A", cidade: "Curitiba", teatro: "Guaíra", data_show: AMANHA, status_venda: "à venda", link_compra: "https://exemplo.invalido/x" },
  { tenant_id: TENANT, artista: "Artista A", cidade: "Passado", teatro: "Antigo", data_show: ONTEM, status_venda: "esgotado" },
  { tenant_id: TENANT, artista: "Outro Artista", cidade: "Recife", teatro: "Santa Isabel", data_show: AMANHA, status_venda: "à venda" },
]).select("id, cidade");

await cenario("INIT devolve a agenda do artista DAQUELE número", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "3.0", action: "INIT" });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };

  checar(corpo.screen === "AGENDA", `tela deveria ser AGENDA, veio "${corpo.screen}"`);
  const shows = corpo.data.shows as { title: string }[];
  checar(shows.length === 1, `deveria trazer 1 show (futuro, do artista do número), veio ${shows.length}`);
  checar(shows[0]?.title.includes("Curitiba") ?? false, `show errado: ${shows[0]?.title}`);
  checar(corpo.data.tem_shows === true, "tem_shows deveria ser true");
  checar(corpo.data.sem_shows === false, "sem_shows deveria ser false quando há shows");
  checar(String(corpo.data.titulo).includes("Artista A"), `o título deveria nomear o artista, veio "${corpo.data.titulo}"`);
});

await cenario("show passado e show de outro artista não aparecem", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "3.0", action: "INIT" });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { data: { shows: { title: string }[] } };
  const titulos = corpo.data.shows.map((s) => s.title).join(" | ");
  checar(!titulos.includes("Passado"), `show que já aconteceu não pode aparecer: ${titulos}`);
  checar(!titulos.includes("Recife"), `show de outro artista não pode aparecer: ${titulos}`);
});

await cenario("data_exchange com show_id devolve o detalhe daquele show", async () => {
  const curitiba = (showsCriados ?? []).find((s) => s.cidade === "Curitiba");
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "3.0", action: "data_exchange", screen: "AGENDA", data: { show_id: curitiba!.id },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(corpo.screen === "DETALHE", `tela deveria ser DETALHE, veio "${corpo.screen}"`);
  checar(String(corpo.data.titulo).includes("Curitiba"), `titulo errado: ${corpo.data.titulo}`);
  checar(corpo.data.tem_link === true, "show com link deveria marcar tem_link");
});

await cenario("cada tela servida fica registrada (é como saber se o clique chegou)", async () => {
  await db.from("events_log").delete().eq("tenant_id", TENANT).eq("event_type", "flow_endpoint_tela");
  await pedir(publicaPem, { version: "7.2", action: "INIT" });
  const curitiba2 = (showsCriados ?? []).find((s) => s.cidade === "Curitiba");
  await pedir(publicaPem, {
    version: "7.2", action: "data_exchange", screen: "AGENDA", data: { show_id: curitiba2!.id },
  });

  const { data } = await db.from("events_log").select("payload")
    .eq("tenant_id", TENANT).eq("event_type", "flow_endpoint_tela").order("created_at");
  const telas = (data ?? []).map((e) => (e.payload as Record<string, unknown>).tela);
  checar(telas.includes("AGENDA"), `INIT deveria registrar a tela AGENDA, veio ${JSON.stringify(telas)}`);
  checar(telas.includes("DETALHE"), `o clique deveria registrar a tela DETALHE, veio ${JSON.stringify(telas)}`);
});

await cenario("show removido entre a lista e o clique volta para a lista, sem erro", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "3.0", action: "data_exchange", screen: "AGENDA",
    data: { show_id: "00000000-0000-4000-8000-000000000000" },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string };
  checar(corpo.screen === "AGENDA", `deveria cair na lista, veio "${corpo.screen}"`);
});

await cenario("agenda vazia responde texto explicativo, não tela quebrada", async () => {
  await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "3.0", action: "INIT" });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { data: Record<string, unknown> };
  checar(corpo.data.tem_shows === false, "tem_shows deveria ser false");
  // O Flow JSON não tem negação (${!data.x} é recusado pela validação da
  // Meta), então o endpoint precisa mandar o par pronto.
  checar(corpo.data.sem_shows === true, "sem_shows deveria ser true");
  checar(String(corpo.data.vazio_texto).length > 10, "deveria ter texto explicativo para o lead");
});

// ─── Central de Shows (Sprint C1) ────────────────────────────────────────────

const FLOW_CENTRAL = "cccccccc-0000-4000-8000-00000000d003";
const TEL_CADASTRADO = "5541900000001";
const TEL_DESCONHECIDO = "5541900000002";
const TOKEN_OK = "sessao-valida-teste";
const TOKEN_EXPIRADO = "sessao-expirada-teste";

await db.from("whatsapp_flows").upsert({
  id: FLOW_CENTRAL, tenant_id: TENANT, cloud_credential_id: CRED,
  nome: "Central", tipo: "central", ativo: true,
});
const { error: erroCliente } = await db.from("clientes").insert({
  tenant_id: TENANT, telefone: TEL_CADASTRADO, origem: "landing",
  nome: "Marina", email: "marina@exemplo.invalido", cadastro_completo: true,
});
if (erroCliente) throw new Error(`fixture de cliente falhou: ${erroCliente.message}`);

// `expira_em` nas DUAS linhas pelo mesmo motivo do FAQ acima: em insert de
// lote o PostgREST manda NULL onde a chave falta, e a coluna é not-null com
// default — o default não entra.
const { error: erroSessao } = await db.from("flow_sessoes").insert([
  {
    tenant_id: TENANT, token: TOKEN_OK, telefone: TEL_CADASTRADO, cloud_credential_id: CRED,
    expira_em: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  },
  {
    tenant_id: TENANT, token: TOKEN_EXPIRADO, telefone: TEL_CADASTRADO, cloud_credential_id: CRED,
    expira_em: new Date(Date.now() - 86_400_000).toISOString(),
  },
]);
if (erroSessao) throw new Error(`fixture de sessão falhou: ${erroSessao.message}`);
// `ativo` explícito em TODAS as linhas: num insert em lote, o PostgREST usa a
// UNIÃO das chaves e manda NULL onde a chave falta — o default da coluna não
// entra. Com `ativo` só na terceira linha, as outras violavam o not-null.
const { error: erroFaq } = await db.from("faq_itens").insert([
  { tenant_id: TENANT, artista: "Artista A", pergunta: "Tem meia-entrada?", resposta: "Sim, com documento.", ordem: 1, ativo: true },
  { tenant_id: TENANT, artista: null, pergunta: "Posso trocar o ingresso?", resposta: "Fale com a bilheteria.", ordem: 2, ativo: true },
  { tenant_id: TENANT, artista: "Artista A", pergunta: "Item inativo", resposta: "não deve aparecer", ordem: 3, ativo: false },
  { tenant_id: TENANT, artista: "Outro", pergunta: "De outro artista", resposta: "não deve aparecer", ordem: 4, ativo: true },
]);
if (erroFaq) throw new Error(`fixture do FAQ falhou: ${erroFaq.message}`);

await cenario("quem tem cadastro cai no MENU, com o nome", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, { version: "7.2", action: "INIT", flow_token: TOKEN_OK });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(corpo.screen === "MENU", `deveria abrir o MENU, veio "${corpo.screen}"`);
  checar(String(corpo.data.saudacao).includes("Marina"), `deveria saudar pelo nome, veio "${corpo.data.saudacao}"`);
  checar(String(corpo.data.titulo).includes("Artista A"), "o título deveria nomear o artista do número");
});

await cenario("sem sessão reconhecida cai na APRESENTACAO, não em erro", async () => {
  const semToken = await pedir(publicaPem, { version: "7.2", action: "INIT" });
  const c1 = await abrirResposta(semToken.res, semToken.chaveAes, semToken.iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(c1.screen === "APRESENTACAO", `sem token deveria apresentar, veio "${c1.screen}"`);
  checar(String(c1.data.aviso_lgpd).length > 20, "a apresentação precisa trazer o aviso de LGPD");

  const expirado = await pedir(publicaPem, { version: "7.2", action: "INIT", flow_token: TOKEN_EXPIRADO });
  const c2 = await abrirResposta(expirado.res, expirado.chaveAes, expirado.iv) as unknown as { screen: string };
  checar(c2.screen === "APRESENTACAO", `sessão expirada deveria apresentar, veio "${c2.screen}"`);

  const desconhecido = await pedir(publicaPem, { version: "7.2", action: "INIT", flow_token: "nao-existe" });
  const c3 = await abrirResposta(desconhecido.res, desconhecido.chaveAes, desconhecido.iv) as unknown as { screen: string };
  checar(c3.screen === "APRESENTACAO", `token desconhecido deveria apresentar, veio "${c3.screen}"`);
});

await cenario("FAQ lista só o que é do artista (ou geral), ativo e na ordem", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "7.2", action: "data_exchange", screen: "MENU", data: { destino: "faq" },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(corpo.screen === "FAQ_LISTA", `deveria abrir o FAQ, veio "${corpo.screen}"`);

  const itens = corpo.data.itens as { title: string }[];
  const titulos = itens.map((i) => i.title).join(" | ");
  checar(itens.length === 2, `deveria trazer 2 itens (do artista + geral), veio ${itens.length}: ${titulos}`);
  checar(!titulos.includes("inativo"), "item inativo não pode aparecer");
  checar(!titulos.includes("De outro artista"), "item de outro artista não pode aparecer");
  checar(itens[0].title.includes("meia-entrada"), `a ordem deveria ser respeitada, veio "${titulos}"`);
  checar(corpo.data.tem_itens === true && corpo.data.sem_itens === false, "o par tem/sem precisa vir pronto (o Flow JSON não tem negação)");
});

await cenario("tocar numa pergunta devolve a resposta", async () => {
  const { data: item } = await db.from("faq_itens").select("id")
    .eq("tenant_id", TENANT).eq("pergunta", "Tem meia-entrada?").single();

  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "7.2", action: "data_exchange", screen: "FAQ_LISTA", data: { faq_id: item!.id },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(corpo.screen === "FAQ_RESPOSTA", `deveria abrir a resposta, veio "${corpo.screen}"`);
  checar(String(corpo.data.resposta).includes("documento"), `resposta errada: ${corpo.data.resposta}`);
});

await cenario("pergunta removida entre a lista e o toque volta para a lista", async () => {
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "7.2", action: "data_exchange", screen: "FAQ_LISTA",
    data: { faq_id: "00000000-0000-4000-8000-000000000000" },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string };
  checar(corpo.screen === "FAQ_LISTA", `deveria cair na lista, veio "${corpo.screen}"`);
});

await cenario("menu → agenda continua funcionando (as duas convivem)", async () => {
  await db.from("agenda_shows_sync").insert({
    tenant_id: TENANT, artista: "Artista A", cidade: "Belém", teatro: "Theatro da Paz",
    data_show: new Date(Date.now() + 86_400_000).toISOString(), status_venda: "à venda",
  });
  const { res, chaveAes, iv } = await pedir(publicaPem, {
    version: "7.2", action: "data_exchange", screen: "MENU", data: { destino: "agenda" },
  });
  const corpo = await abrirResposta(res, chaveAes, iv) as unknown as { screen: string; data: Record<string, unknown> };
  checar(corpo.screen === "AGENDA", `deveria abrir a agenda, veio "${corpo.screen}"`);
  const shows = corpo.data.shows as { title: string }[];
  checar(shows.some((s) => s.title.includes("Belém")), "a agenda do artista deveria aparecer");
  await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
});

// ─── Limpeza ─────────────────────────────────────────────────────────────────// ─── Limpeza ─────────────────────────────────────────────────────────────────

await db.from("agenda_shows_sync").delete().eq("tenant_id", TENANT);
await db.from("faq_itens").delete().eq("tenant_id", TENANT);
await db.from("flow_sessoes").delete().eq("tenant_id", TENANT);
await db.from("clientes").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_flows").delete().eq("id", FLOW_CENTRAL);
await db.from("internal_secrets").delete().eq("key", `flow_private_key:${PN}`);
await db.from("events_log").delete().eq("tenant_id", TENANT);
await db.from("whatsapp_cloud_credentials").delete().eq("id", CRED);
await db.from("tenants").delete().eq("id", TENANT);

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
