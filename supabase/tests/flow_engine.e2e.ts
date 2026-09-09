// Teste ponta a ponta do flow-engine (Trilha A) — cobre a seção "Critérios de
// teste e validação" do PRD para keyword_automation.
//
// COMO RODAR: `npm run test:db` (ou `deno run -A supabase/tests/flow_engine.e2e.ts`)
// com o Supabase local de pé. NUNCA contra produção — cria e apaga dados.
//
// Por que não é SQL: a lógica testada aqui é do motor (TypeScript), não do
// banco. E por que não roda no edge runtime local: `supabase functions serve`
// não sobe worker neste ambiente (falha de resolução de nome dentro do
// container), então a função é importada e servida pelo próprio Deno do host —
// o código exercitado é exatamente o mesmo do deploy.
//
// A Graph API é substituída por um stub local (GRAPH_API_BASE_OVERRIDE): nada
// sai para a Meta, e as mensagens "enviadas" ficam inspecionáveis.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const STUB_PORT = 8787;
const ENGINE_PORT = 8788;

const db = createClient(DB_URL, SERVICE_KEY);

// ─── Stub da Graph API ───────────────────────────────────────────────────────

interface EnvioCapturado {
  to: string;
  body: string;
}

let enviadas: EnvioCapturado[] = [];
// Erro a devolver na próxima chamada (para testar teto de tier), se houver.
let proximoErro: { status: number; code: number } | null = null;

const stub = Deno.serve({ port: STUB_PORT, onListen: () => {} }, async (req) => {
  const corpo = await req.json();
  if (proximoErro) {
    const erro = proximoErro;
    proximoErro = null;
    return new Response(JSON.stringify({ error: { message: "stub", code: erro.code } }), {
      status: erro.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  enviadas.push({ to: corpo.to, body: corpo.text?.body ?? "" });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.STUB_${crypto.randomUUID()}` }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Sobe o flow-engine no host ──────────────────────────────────────────────

Deno.env.set("GRAPH_API_BASE_OVERRIDE", `http://127.0.0.1:${STUB_PORT}`);
Deno.env.set("SUPABASE_URL", DB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const engineModule = new URL("../functions/flow-engine/index.ts", import.meta.url).href;
// A função chama Deno.serve na porta padrão; sobrescrevemos para não colidir.
const serveOriginal = Deno.serve;
let engineHandler: ((req: Request) => Promise<Response> | Response) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: any) => {
  engineHandler = typeof handler === "function" ? handler : handler.handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};
await import(engineModule);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = serveOriginal;

if (!engineHandler) throw new Error("flow-engine não registrou handler");

async function chamarEngineBruto(
  payload: Record<string, unknown>,
): Promise<{ status: number; resultado: string | null }> {
  const res = await engineHandler!(
    new Request(`http://127.0.0.1:${ENGINE_PORT}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  const json = await res.json().catch(() => ({}));
  return { status: res.status, resultado: (json as { resultado?: string }).resultado ?? null };
}

async function chamarEngine(payload: Record<string, unknown>): Promise<string> {
  const { status, resultado } = await chamarEngineBruto(payload);
  if (status !== 200) throw new Error(`flow-engine ${status}: resultado=${resultado}`);
  return resultado as string;
}

/**
 * DDL no banco local (criar/derrubar trigger de simulação de falha) — o client
 * PostgREST não faz DDL, então isso vai por psql mesmo, como os testes .sql.
 */
async function psql(sql: string): Promise<void> {
  const url = Deno.env.get("LOCAL_DATABASE_URL") ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const cmd = new Deno.Command("psql", {
    args: [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) throw new Error(`psql falhou: ${new TextDecoder().decode(stderr)}`);
}

// ─── Infra de asserção ───────────────────────────────────────────────────────

let falhas = 0;
let passou = 0;

function checar(condicao: boolean, mensagem: string): void {
  if (condicao) {
    passou++;
  } else {
    falhas++;
    console.error(`  ✗ ${mensagem}`);
  }
}

async function cenario(nome: string, fn: () => Promise<void>): Promise<void> {
  enviadas = [];
  proximoErro = null;
  await limparDados();
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

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const CRED_A = "aaaaaaaa-0000-4000-8000-00000000c001";
const CRED_B = "bbbbbbbb-0000-4000-8000-00000000c002";
const SESSAO_A = "aaaaaaaa-0000-4000-8000-00000000e001";
const SESSAO_B = "bbbbbbbb-0000-4000-8000-00000000e002";
const FLOW_A = "aaaaaaaa-0000-4000-8000-00000000f001";
const FLOW_B = "bbbbbbbb-0000-4000-8000-00000000f002";
const TELEFONE = "5541988887777";

async function limparDados(): Promise<void> {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await db.from("flow_sessoes").delete().eq("tenant_id", tenant);
    await db.from("flow_mensagens_processadas").delete().eq("tenant_id", tenant);
    await db.from("flow_contato_estado").delete().eq("tenant_id", tenant);
    await db.from("clientes").delete().eq("tenant_id", tenant);
    await db.from("messages").delete().eq("tenant_id", tenant);
    await db.from("events_log").delete().eq("tenant_id", tenant);
    await db.from("whatsapp_opt_outs").delete().eq("tenant_id", tenant);
    await db.from("campaign_recipients").delete().eq("tenant_id", tenant);
    await db.from("campaigns").delete().eq("tenant_id", tenant);
    await db.from("flow_palavras_chave").delete().eq("tenant_id", tenant);
  }
  await semear();
}

async function semear(): Promise<void> {
  await db.from("flow_palavras_chave").insert([
    { tenant_id: TENANT_A, flow_id: FLOW_A, palavra_chave: "meia entrada", tipo_resposta: "texto", resposta: "Meia para estudantes com documento." },
    { tenant_id: TENANT_A, flow_id: FLOW_A, palavra_chave: "ingresso", tipo_resposta: "link", resposta: "https://exemplo.invalido/ingressos" },
  ]);
}

async function montarEstrutura(): Promise<void> {
  await db.from("tenants").upsert([
    { id: TENANT_A, name: "Tenant A e2e", slug: "tenant-a-e2e" },
    { id: TENANT_B, name: "Tenant B e2e", slug: "tenant-b-e2e" },
  ]);
  await db.from("whatsapp_cloud_credentials").upsert([
    { id: CRED_A, tenant_id: TENANT_A, waba_id: "WABA_E2E", phone_number_id: "PN_E2E_A", access_token: "tok", active: true },
    { id: CRED_B, tenant_id: TENANT_B, waba_id: "WABA_E2E_B", phone_number_id: "PN_E2E_B", access_token: "tok", active: true },
  ]);
  await db.from("wa_sessions").upsert([
    { id: SESSAO_A, tenant_id: TENANT_A, phone_number: "+55 41 0000-0001", channel: "cloud_api", cloud_credential_id: CRED_A, status: "connected" },
    { id: SESSAO_B, tenant_id: TENANT_B, phone_number: "+55 41 0000-0002", channel: "cloud_api", cloud_credential_id: CRED_B, status: "connected" },
  ]);
  await db.from("whatsapp_flows").upsert([
    { id: FLOW_A, tenant_id: TENANT_A, cloud_credential_id: CRED_A, nome: "Flow A", tipo: "keyword_automation", ativo: true, mensagem_boas_vindas: "BOAS-VINDAS", mensagem_fallback: "FALLBACK" },
    { id: FLOW_B, tenant_id: TENANT_B, cloud_credential_id: CRED_B, nome: "Flow B", tipo: "keyword_automation", ativo: true, mensagem_boas_vindas: "BOAS-VINDAS B", mensagem_fallback: "FALLBACK B" },
  ]);
}

function msg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: `wamid.${crypto.randomUUID()}`,
    phoneNumberId: "PN_E2E_A",
    from: TELEFONE,
    text: "oi",
    type: "text",
    sessionId: SESSAO_A,
    ...over,
  };
}

async function cliente(tenant = TENANT_A) {
  const { data } = await db.from("clientes").select("*").eq("tenant_id", tenant).eq("telefone", TELEFONE).maybeSingle();
  return data;
}

async function eventos(tipo: string, tenant = TENANT_A): Promise<number> {
  const { count } = await db.from("events_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenant).eq("event_type", tipo);
  return count ?? 0;
}

/** Marca o cliente como já cadastrado, pulando o gate (que tem cenário próprio). */
async function clienteJaCadastrado(tenant = TENANT_A): Promise<void> {
  await db.from("clientes").insert({
    tenant_id: tenant,
    telefone: TELEFONE,
    origem: "campanha",
    cadastro_completo: true,
  });
}

// ─── Cenários ────────────────────────────────────────────────────────────────

await montarEstrutura();

await cenario("idempotência: mesmo wamid duas vezes → uma resposta só", async () => {
  await clienteJaCadastrado();
  const m = msg({ text: "quero ingresso" });
  const r1 = await chamarEngine(m);
  const r2 = await chamarEngine(m);
  checar(r1 === "keyword", `1ª chamada deveria casar keyword, veio "${r1}"`);
  checar(r2 === "ja_processada", `2ª chamada deveria ser ignorada, veio "${r2}"`);
  const respostas = enviadas.filter((e) => e.body.includes("ingressos"));
  checar(respostas.length === 1, `deveria ter enviado 1 resposta de keyword, enviou ${respostas.length}`);
});

await cenario("boas-vindas é aditiva: primeiro contato com keyword recebe as duas", async () => {
  await clienteJaCadastrado();
  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r === "keyword", `resultado deveria ser keyword, veio "${r}"`);
  checar(enviadas.length === 2, `deveria enviar boas-vindas + resposta (2), enviou ${enviadas.length}`);
  checar(enviadas[0].body === "BOAS-VINDAS", "primeira mensagem deveria ser as boas-vindas");
  checar(enviadas[1].body.includes("ingressos"), "segunda deveria ser a resposta da keyword");
});

await cenario("keyword mais específica vence a genérica", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "tem meia entrada?" }));
  checar(
    enviadas.some((e) => e.body.includes("estudantes")),
    "deveria responder a keyword 'meia entrada', não 'ingresso'",
  );
});

await cenario("acento/caixa/plural: 'INGRESSOS' casa com 'ingresso'", async () => {
  await clienteJaCadastrado();
  const r = await chamarEngine(msg({ text: "Onde compro INGRESSOS?" }));
  checar(r === "keyword", `deveria casar keyword, veio "${r}"`);
});

await cenario("nenhuma keyword bate → fallback", async () => {
  await clienteJaCadastrado();
  const r = await chamarEngine(msg({ text: "qualquer coisa aleatória" }));
  checar(r === "fallback", `deveria cair em fallback, veio "${r}"`);
  checar(enviadas.some((e) => e.body === "FALLBACK"), "deveria enviar o texto de fallback");
});

await cenario("todo fallback vira evento com o texto (alimenta a tela de Flows)", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "vocês aceitam pix?" }));
  checar(await eventos("flow_fallback") === 1, "o 1º fallback já deve gerar evento, não só o 3º");

  const { data } = await db.from("events_log").select("payload")
    .eq("tenant_id", TENANT_A).eq("event_type", "flow_fallback").limit(1).single();
  const p = (data?.payload ?? {}) as Record<string, unknown>;
  checar(p.texto === "vocês aceitam pix?", `o texto perguntado deve ir no evento, veio "${p.texto}"`);
  checar(p.flowId === FLOW_A, "o evento deve identificar o Flow");
  checar(p.consecutivos === 1, `deve registrar o contador, veio "${p.consecutivos}"`);

  // Keyword que bate não pode gerar evento de fallback.
  await chamarEngine(msg({ text: "quero ingresso" }));
  checar(await eventos("flow_fallback") === 1, "keyword que bate não pode virar fallback");
});

await cenario("3 fallbacks seguidos → alerta + pausa; keyword depois destrava", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "aaa" }));
  await chamarEngine(msg({ text: "bbb" }));
  const r3 = await chamarEngine(msg({ text: "ccc" }));
  checar(r3 === "fallback_alerta", `3º fallback deveria alertar, veio "${r3}"`);
  checar(await eventos("flow_fallback_alerta") === 1, "deveria ter logado flow_fallback_alerta");

  const antes = enviadas.length;
  const r4 = await chamarEngine(msg({ text: "ddd" }));
  checar(r4 === "pausado", `4ª mensagem deveria só capturar, veio "${r4}"`);
  checar(enviadas.length === antes, "pausado não pode enviar nada");

  const r5 = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r5 === "keyword", `keyword deveria destravar a pausa, veio "${r5}"`);
  const { data: estado } = await db.from("flow_contato_estado").select("*").eq("flow_id", FLOW_A).maybeSingle();
  checar(estado?.pausado_aguardando_humano === false, "keyword deveria zerar a pausa");
  checar(estado?.fallbacks_consecutivos === 0, "keyword deveria zerar o contador de fallback");
});

await cenario("reset de 14 dias: 15 dias depois recebe boas-vindas de novo; antes não", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "quero ingresso" }));
  checar(enviadas.filter((e) => e.body === "BOAS-VINDAS").length === 1, "primeira vez manda boas-vindas");

  await chamarEngine(msg({ text: "quero ingresso" }));
  checar(enviadas.filter((e) => e.body === "BOAS-VINDAS").length === 1, "dentro dos 14 dias NÃO repete boas-vindas");

  await db.from("flow_contato_estado")
    .update({ updated_at: new Date(Date.now() - 15 * 86_400_000).toISOString() })
    .eq("flow_id", FLOW_A).eq("contato_telefone", TELEFONE);

  await chamarEngine(msg({ text: "quero ingresso" }));
  checar(enviadas.filter((e) => e.body === "BOAS-VINDAS").length === 2, "após 15 dias de inatividade manda boas-vindas de novo");
});

await cenario("opt-out bloqueia tudo, inclusive o gate de cadastro", async () => {
  await db.from("whatsapp_opt_outs").insert({ tenant_id: TENANT_A, phone_e164: TELEFONE });
  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r === "opt_out", `deveria bloquear por opt-out, veio "${r}"`);
  checar(enviadas.length === 0, "opt-out não pode receber nenhum envio");
  checar(await cliente() === null, "opt-out não deve nem criar cadastro");
});

await cenario("sem Flow ativo: encerra, loga e não responde", async () => {
  await db.from("whatsapp_flows").update({ ativo: false }).eq("id", FLOW_A);
  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  await db.from("whatsapp_flows").update({ ativo: true }).eq("id", FLOW_A);
  checar(r === "sem_flow_ativo", `deveria encerrar sem flow, veio "${r}"`);
  checar(enviadas.length === 0, "sem Flow ativo não pode enviar nada");
  checar(await eventos("sem_flow_ativo") === 1, "deveria logar sem_flow_ativo");
});

await cenario("gate completo: nome → e-mail → responde a pergunta original", async () => {
  const r1 = await chamarEngine(msg({ text: "tem meia entrada?" }));
  checar(r1 === "gate_iniciado", `deveria iniciar o gate, veio "${r1}"`);
  checar(enviadas.length === 1 && enviadas[0].body.includes("como você se chama"), "deveria pedir o nome");
  const c1 = await cliente();
  checar(c1?.origem === "organico", "cliente sem campanha é orgânico");
  checar(c1?.mensagem_pendente === "tem meia entrada?", "a pergunta original deve ficar pendente");
  checar(c1?.gate_iniciado_por_flow_id === FLOW_A, "gate_iniciado_por_flow_id deve ser gravado");

  const r2 = await chamarEngine(msg({ text: "Marcelo" }));
  checar(r2 === "gate_em_andamento", `deveria pedir o e-mail, veio "${r2}"`);
  checar((await cliente())?.nome === "Marcelo", "nome deveria ter sido gravado");

  const r3 = await chamarEngine(msg({ text: "marcelo@exemplo.com" }));
  checar(r3 === "keyword", `ao completar deveria responder a pergunta pendente, veio "${r3}"`);
  const c3 = await cliente();
  checar(c3?.cadastro_completo === true, "cadastro deveria estar completo");
  checar(c3?.email === "marcelo@exemplo.com", "e-mail deveria ter sido gravado");
  checar(c3?.mensagem_pendente === null, "mensagem_pendente deveria ser limpa");
  checar(
    enviadas.some((e) => e.body.includes("estudantes")),
    "a pergunta original ('meia entrada') deveria ter sido respondida no fim do gate",
  );
});

await cenario("gate: pergunta feita DURANTE o gate não se perde", async () => {
  await chamarEngine(msg({ text: "oi" })); // inicia gate
  await chamarEngine(msg({ text: "vocês têm meia entrada para estudante?" }));
  const c = await cliente();
  checar(c?.nome === null, "pergunta não pode virar nome");
  checar(
    (c?.mensagem_pendente ?? "").includes("meia entrada"),
    `mensagem durante o gate deveria ser concatenada, pendente="${c?.mensagem_pendente}"`,
  );
  checar(
    (c?.mensagem_pendente ?? "").includes("oi"),
    "a mensagem original também deve continuar lá (concatena, não substitui)",
  );
});

await cenario("gate: pergunta CURTA durante o gate não vira nome (palavras-gatilho)", async () => {
  await chamarEngine(msg({ text: "oi" }));
  await chamarEngine(msg({ text: "quero ingresso" }));
  const c = await cliente();
  checar(c?.nome === null, `"quero ingresso" não pode virar nome (veio "${c?.nome}")`);
  checar(
    (c?.mensagem_pendente ?? "").includes("quero ingresso"),
    "a pergunta curta precisa ir para mensagem_pendente",
  );
});

await cenario("nome legítimo que contém gatilho como parte da palavra é aceito", async () => {
  await chamarEngine(msg({ text: "oi" }));
  // "Tomás" contém "tom"; a checagem é por palavra inteira e sem acento, então
  // não pode reprovar nomes reais.
  await chamarEngine(msg({ text: "Tomás Quental" }));
  checar((await cliente())?.nome === "Tomás Quental", "nome legítimo não pode ser reprovado");
});

await cenario("validação de nome rejeita frase/pergunta, vazio e só número", async () => {
  await chamarEngine(msg({ text: "oi" }));
  const c0 = await cliente();
  checar(c0?.aguardando_campo === "nome", "deveria estar aguardando o nome");
  await chamarEngine(msg({ text: "quero saber sobre o show de sábado" }));
  checar((await cliente())?.nome === null, "frase longa não pode virar nome");

  await limparDados();
  await chamarEngine(msg({ text: "oi" }));
  await chamarEngine(msg({ text: "12345" }));
  checar((await cliente())?.nome === null, "só número não pode virar nome");
});

await cenario("gate degrada após 2 tentativas no mesmo campo", async () => {
  await chamarEngine(msg({ text: "oi" }));               // pede nome
  await chamarEngine(msg({ text: "???" }));              // 1ª falha
  await chamarEngine(msg({ text: "!!!!" }));             // 2ª falha → degrade
  const c = await cliente();
  checar(c?.pulou_cadastro === true, "após 2 falhas deveria marcar pulou_cadastro");
  checar(c?.nome === null, "o campo pulado fica nulo");
  checar(c?.aguardando_campo === "email", `deveria avançar para o e-mail, está em "${c?.aguardando_campo}"`);
  checar(c?.tentativas_campo_atual === 0, "o contador deveria zerar ao trocar de campo");
});

await cenario("mensagem não-texto durante o gate: reprompt, não vira resposta", async () => {
  await chamarEngine(msg({ text: "oi" }));
  const antes = enviadas.length;
  const r = await chamarEngine(msg({ text: null, type: "audio" }));
  checar(r === "gate_repergunta", `áudio deveria gerar reprompt, veio "${r}"`);
  checar(enviadas.length === antes + 1, "deveria mandar o pedido de texto");
  checar((await cliente())?.nome === null, "áudio não pode virar nome");
});

await cenario("contato vindo de campanha nunca passa pelo gate", async () => {
  const { data: campanha } = await db.from("campaigns").insert({
    tenant_id: TENANT_A, credential_id: CRED_A, name: "camp e2e",
    template_name: "t", template_language: "pt_BR", status: "completed",
  }).select("id").single();
  await db.from("campaign_recipients").insert({
    campaign_id: campanha!.id, tenant_id: TENANT_A, phone_e164: TELEFONE, status: "delivered",
  });

  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r === "keyword", `contato de campanha deveria ir direto à keyword, veio "${r}"`);
  const c = await cliente();
  checar(c?.origem === "campanha", "origem deveria ser 'campanha'");
  checar(c?.cadastro_completo === true, "contato de campanha já entra cadastrado");
});

await cenario("lock do gate: com o lock tomado, a mensagem é guardada, não avaliada", async () => {
  await chamarEngine(msg({ text: "oi" }));   // cria cliente e inicia gate
  const c = await cliente();
  // Simula outra invocação segurando o lock.
  await db.from("clientes").update({ gate_lock_ate: new Date(Date.now() + 30_000).toISOString() }).eq("id", c!.id);

  const r = await chamarEngine(msg({ text: "Marcelo" }));
  checar(r === "gate_ocupado", `com lock tomado deveria adiar, veio "${r}"`);
  const depois = await cliente();
  checar(depois?.nome === null, "não pode gravar o nome sem o lock");
  checar((depois?.mensagem_pendente ?? "").includes("Marcelo"), "a mensagem precisa ser preservada");
});

await cenario("clique de botão de template nunca vira comparação de keyword", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "ingresso", type: "button" }));
  checar(
    !enviadas.some((e) => e.body.includes("exemplo.invalido/ingressos")),
    "clique de botão não pode disparar resposta de keyword",
  );
  checar(await eventos("flow_clique_de_botao_ignorado") === 1, "deveria logar o clique ignorado");
});

await cenario("teto de tier: erro 131048 é logado, não relançado nem repetido", async () => {
  await clienteJaCadastrado();
  proximoErro = { status: 400, code: 131048 };
  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r === "keyword", `o motor deveria concluir mesmo com falha de envio, veio "${r}"`);
  checar(await eventos("flow_reply_tier_limit") === 1, "deveria logar flow_reply_tier_limit");
});

await cenario("resposta enviada vira histórico em messages", async () => {
  await clienteJaCadastrado();
  await chamarEngine(msg({ text: "quero ingresso" }));
  const { data: salvas } = await db.from("messages").select("body, from_me").eq("tenant_id", TENANT_A).eq("from_me", true);
  checar((salvas?.length ?? 0) >= 1, "a resposta automática deveria ser gravada em messages");
  checar(await eventos("flow_reply_sent") >= 1, "deveria logar flow_reply_sent");
});

await cenario("isolamento de tenant: mesmo telefone em dois tenants não se mistura", async () => {
  await clienteJaCadastrado(TENANT_A);
  await db.from("clientes").insert({ tenant_id: TENANT_B, telefone: TELEFONE, origem: "campanha", cadastro_completo: true });
  // Opt-out só no tenant B: o tenant A tem que continuar respondendo.
  await db.from("whatsapp_opt_outs").insert({ tenant_id: TENANT_B, phone_e164: TELEFONE });

  const rA = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(rA === "keyword", `tenant A não deveria ser afetado pelo opt-out do B, veio "${rA}"`);

  const rB = await chamarEngine(msg({ phoneNumberId: "PN_E2E_B", sessionId: SESSAO_B, text: "quero ingresso" }));
  checar(rB === "opt_out", `tenant B deveria estar em opt-out, veio "${rB}"`);

  const { count } = await db.from("flow_contato_estado").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_B);
  checar((count ?? 0) === 0, "tenant B em opt-out não pode ter estado de conversa criado");
});

await cenario("desfechos legítimos de 'não responder' continuam sendo 200", async () => {
  await clienteJaCadastrado();
  await db.from("whatsapp_flows").update({ ativo: false }).eq("id", FLOW_A);
  const semFlow = await chamarEngineBruto(msg({ text: "oi" }));
  await db.from("whatsapp_flows").update({ ativo: true }).eq("id", FLOW_A);
  checar(semFlow.status === 200, `sem_flow_ativo deveria ser 200, veio ${semFlow.status}`);
  checar(semFlow.resultado === "sem_flow_ativo", `veio "${semFlow.resultado}"`);

  const m = msg({ text: "quero ingresso" });
  await chamarEngine(m);
  const repetida = await chamarEngineBruto(m);
  checar(repetida.status === 200, `mensagem repetida deveria ser 200, veio ${repetida.status}`);
  checar(repetida.resultado === "ja_processada", `veio "${repetida.resultado}"`);
});

await cenario("falha interna responde 5xx, não 200 (senão o webhook não registra)", async () => {
  await clienteJaCadastrado();

  // Força o claim de idempotência a falhar — é a hipótese para a mensagem que
  // ficou sem processar em 07/09/2026 (indisponibilidade transitória do banco).
  // Antes do fix, o motor devolvia 200 com "erro_claim" no corpo e o webhook
  // registrava a invocação como bem-sucedida: a mensagem sumia sem rastro.
  await psql(`
    create or replace function pg_temp_falha_claim() returns trigger language plpgsql as $$
    begin raise exception 'falha simulada no claim'; end; $$;
    create trigger t_falha_claim before insert on flow_mensagens_processadas
      for each row execute function pg_temp_falha_claim();
  `);

  try {
    const r = await chamarEngineBruto(msg({ text: "quero ingresso" }));
    checar(r.resultado === "erro_claim", `deveria falhar no claim, veio "${r.resultado}"`);
    checar(r.status >= 500, `falha de claim tem que responder 5xx, veio ${r.status}`);
    checar(enviadas.length === 0, "não pode responder nada quando nem o claim funcionou");
  } finally {
    await psql(`
      drop trigger if exists t_falha_claim on flow_mensagens_processadas;
      drop function if exists pg_temp_falha_claim();
    `);
  }
});

await cenario("retry do campo pulado: volta por inatividade repergunta o que faltou", async () => {
  // Degrada o campo nome (2 tentativas falhas), como o gate faz.
  await chamarEngine(msg({ text: "oi" }));
  await chamarEngine(msg({ text: "???" }));
  await chamarEngine(msg({ text: "!!!!" }));
  const c1 = await cliente();
  checar(c1?.pulou_cadastro === true, "pré-condição: deveria ter pulado o campo");

  // Conclui o cadastro pelo e-mail para sair do gate.
  await chamarEngine(msg({ text: "fulano@exemplo.com" }));
  const c2 = await cliente();
  checar(c2?.cadastro_completo === true, "pré-condição: cadastro deveria estar completo");
  checar(c2?.nome === null, "pré-condição: o nome deveria ter ficado nulo");

  // Sem inatividade, NÃO repergunta (senão viraria insistência a cada mensagem).
  enviadas = [];
  const semReset = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(semReset !== "gate_reaberto", `dentro dos 14 dias não pode reabrir o gate, veio "${semReset}"`);

  // Envelhece o estado: é a volta por inatividade que o PRD usa como gatilho.
  await db.from("flow_contato_estado")
    .update({ updated_at: new Date(Date.now() - 15 * 86_400_000).toISOString() })
    .eq("flow_id", FLOW_A).eq("contato_telefone", TELEFONE);

  enviadas = [];
  const comReset = await chamarEngine(msg({ text: "tem meia entrada?" }));
  checar(comReset === "gate_reaberto", `após 15 dias deveria reperguntar o campo pulado, veio "${comReset}"`);
  checar(enviadas.some((e) => e.body.includes("como você se chama")), "deveria perguntar o nome de novo");

  const c3 = await cliente();
  checar(c3?.aguardando_campo === "nome", `deveria voltar a aguardar o nome, está em "${c3?.aguardando_campo}"`);
  checar(
    (c3?.mensagem_pendente ?? "").includes("meia entrada"),
    "a pergunta feita na volta não pode se perder",
  );
});

await cenario("dado apagado a pedido do titular nunca é pedido de novo (LGPD)", async () => {
  await chamarEngine(msg({ text: "oi" }));
  await chamarEngine(msg({ text: "???" }));
  await chamarEngine(msg({ text: "!!!!" }));
  await chamarEngine(msg({ text: "fulano@exemplo.com" }));

  // Simula a ação de admin de /api/clientes/[id]/pii.
  const c = await cliente();
  await db.from("clientes").update({
    nome: null, email: null, mensagem_pendente: null,
    pii_apagada_em: new Date().toISOString(),
    cadastro_completo: true, aguardando_campo: null,
  }).eq("id", c!.id);

  await db.from("flow_contato_estado")
    .update({ updated_at: new Date(Date.now() - 15 * 86_400_000).toISOString() })
    .eq("flow_id", FLOW_A).eq("contato_telefone", TELEFONE);

  enviadas = [];
  const r = await chamarEngine(msg({ text: "quero ingresso" }));
  checar(r !== "gate_reaberto", `não pode reabrir o gate para quem pediu exclusão, veio "${r}"`);
  checar(
    !enviadas.some((e) => e.body.includes("como você se chama")),
    "não pode voltar a pedir o nome de quem exerceu o direito de exclusão",
  );
  checar((await cliente())?.nome === null, "o nome deve continuar apagado");
});

await cenario("abrir_flow grava a sessão que identifica a pessoa no endpoint", async () => {
  await clienteJaCadastrado();
  const FLOW_AGENDA = "aaaaaaaa-0000-4000-8000-00000000f009";
  await db.from("whatsapp_flows").upsert({
    id: FLOW_AGENDA, tenant_id: TENANT_A, cloud_credential_id: CRED_A,
    nome: "Agenda", tipo: "agenda_shows", ativo: true,
    meta_flow_id: "META_FLOW_TESTE", meta_flow_cta: "Ver agenda",
  });
  await db.from("flow_sessoes").delete().eq("tenant_id", TENANT_A);
  await db.from("flow_palavras_chave").insert({
    tenant_id: TENANT_A, flow_id: FLOW_A, palavra_chave: "agenda",
    tipo_resposta: "abrir_flow", flow_destino_id: FLOW_AGENDA,
  });

  const r = await chamarEngine(msg({ text: "quero ver a agenda" }));
  checar(r === "abrir_flow", `deveria abrir o Flow, veio "${r}"`);

  const { data: sessoes } = await db.from("flow_sessoes").select("token, telefone, origem")
    .eq("tenant_id", TENANT_A);
  checar((sessoes ?? []).length === 1, `deveria gravar 1 sessão, gravou ${(sessoes ?? []).length}`);
  checar(sessoes?.[0]?.telefone === TELEFONE, "a sessão precisa guardar o telefone de quem abriu");
  checar(
    /^[0-9a-f-]{36}$/.test(sessoes?.[0]?.token ?? ""),
    `o token deve ser aleatório (uuid), veio "${sessoes?.[0]?.token}"`,
  );
  checar(
    !(sessoes?.[0]?.token ?? "").includes(TELEFONE),
    "o telefone NUNCA pode estar dentro do token — ele trafega pelo aparelho",
  );

  await db.from("flow_sessoes").delete().eq("tenant_id", TENANT_A);
  await db.from("whatsapp_flows").delete().eq("id", FLOW_AGENDA);
});

// ─── Encerramento ────────────────────────────────────────────────────────────

await limparDados();
await db.from("whatsapp_flows").delete().in("id", [FLOW_A, FLOW_B]);
await db.from("wa_sessions").delete().in("id", [SESSAO_A, SESSAO_B]);
await db.from("whatsapp_cloud_credentials").delete().in("id", [CRED_A, CRED_B]);
await db.from("tenants").delete().in("id", [TENANT_A, TENANT_B]);
await stub.shutdown();

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
