// Motor de decisão da automação por Flow — tipo `keyword_automation`.
// Passos 0 a 9 do "Fluxo técnico" de docs/prd/prd-automacao-flows-whatsapp.md.
// Posicionamento: CLAUDE.md, "Segunda reabertura parcial e consciente
// (04/09/2026)" — resposta por REGRA FIXA, nunca IA gerando texto livre.
//
// Separada da função de captura de propósito (mesmo padrão de campaign-sender
// ficar fora do webhook de campanhas): o whatsapp-cloud-webhook salva a
// mensagem e invoca esta função; se esta falhar, a captura já aconteceu.
// verify_jwt=true — só é chamada internamente, com service role.
//
// ─── REGRA DE ISOLAMENTO (a mais crítica deste arquivo) ─────────────────────
// Roda com service role, processando o webhook compartilhado de TODOS os
// tenants: o RLS não protege nada aqui. Toda query em clientes,
// campaign_recipients, flow_palavras_chave, flow_contato_estado,
// whatsapp_opt_outs e flow_mensagens_processadas leva `.eq("tenant_id", ...)`
// explícito — e o tenant vem SEMPRE da credencial resolvida pelo
// phone_number_id do payload, nunca de um campo do corpo da requisição (que é
// exatamente o que tornaria um bug de query um vazamento entre negócios).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  acharKeyword,
  type PalavraChave,
} from "./keywords.ts";
import {
  type CampoGate,
  concatenarPendente,
  MAX_TENTATIVAS_POR_CAMPO,
  perguntaDoCampo,
  proximoCampo,
  reperguntaDoCampo,
  TEXTOS,
  validarCampo,
} from "./gate.ts";
import { enviarFlow, enviarTexto, FORA_DA_JANELA_CODE, MESSAGING_LIMIT_CODES } from "./graph.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const DIAS_RESET_BOAS_VINDAS = 14;
const FALLBACKS_ATE_ALERTA = 3;
const LOCK_SEGUNDOS = 30;

interface FlowEngineRequest {
  messageId: string; // wamid
  phoneNumberId: string;
  from: string; // E.164 sem "+"
  text: string | null;
  type: string; // text | image | audio | button | interactive | ...
  sessionId: string;
}

interface Credencial {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  access_token: string;
}

interface Flow {
  id: string;
  tenant_id: string;
  mensagem_boas_vindas: string | null;
  mensagem_fallback: string | null;
}

interface Cliente {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string;
  cadastro_completo: boolean;
  aguardando_campo: CampoGate | null;
  tentativas_campo_atual: number;
  pulou_cadastro: boolean;
  mensagem_pendente: string | null;
}

interface ContatoEstado {
  id: string;
  recebeu_boas_vindas: boolean;
  fallbacks_consecutivos: number;
  pausado_aguardando_humano: boolean;
  updated_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload: FlowEngineRequest;
  try {
    payload = await req.json() as FlowEngineRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!payload.messageId || !payload.phoneNumberId || !payload.from || !payload.sessionId) {
    return new Response("Missing required fields", { status: 400 });
  }

  try {
    const resultado = await processar(payload);

    // Resultado de FALHA responde 5xx, não 200 (04→09/09/2026). O
    // whatsapp-cloud-webhook só marca a linha `flow_engine_disparado` com erro
    // quando a resposta é não-2xx; devolvendo 200 com "erro_claim" no corpo, a
    // falha passava por sucesso e não sobrava rastro nenhum de que a mensagem
    // não fora processada. Foi assim que uma mensagem de 07/09/2026 ficou sem
    // processar sem ninguém saber — só apareceu ao cruzar 127 invocações
    // contra 126 conclusões. A garantia de "não é fire-and-forget" do PRD
    // cobria a invocação; agora cobre também o resultado dela.
    const status = RESULTADOS_DE_FALHA.has(resultado) ? 500 : 200;

    return new Response(JSON.stringify({ resultado }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[flow-engine] erro não tratado:", mensagem);
    await logEvent(null, payload.sessionId, "error", { messageId: payload.messageId }, `flow-engine: ${mensagem}`);
    return new Response(JSON.stringify({ error: mensagem }), { status: 500 });
  }
});

// Resultados que significam "não processei" — o motor não concluiu a decisão.
// Não confundir com desfechos legítimos de "processei e a resposta é não
// responder" (sem_flow_ativo, opt_out, pausado, ja_processada), que são 200.
const RESULTADOS_DE_FALHA = new Set(["erro_claim", "erro_cliente"]);

async function processar(payload: FlowEngineRequest): Promise<string> {
  const { messageId, phoneNumberId, from, sessionId } = payload;

  // ── Credencial → tenant (origem única e confiável do tenant_id) ──
  const { data: credencial } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("id, tenant_id, phone_number_id, access_token")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle<Credencial>();

  if (!credencial) {
    // Número sem credencial própria (chegou pelo fallback por WABA do
    // whatsapp-cloud-webhook): captura sim, resposta automática NUNCA —
    // responder por um número que ninguém configurou é pior que silêncio.
    await logEvent(null, sessionId, "flow_sem_credencial", { messageId, phoneNumberId });
    return "sem_credencial";
  }

  const tenantId = credencial.tenant_id;

  // ── Passo 0: idempotência (claim atômico, não consulta-depois-insere) ──
  const { data: claim, error: claimError } = await supabase
    .from("flow_mensagens_processadas")
    .upsert(
      { tenant_id: tenantId, message_id: messageId },
      { onConflict: "tenant_id,message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (claimError) {
    // console.error primeiro: se o banco está indisponível (foi a hipótese
    // para a mensagem não processada de 07/09/2026), o próprio logEvent
    // falha, e o log da plataforma é o único rastro que sobra. O 5xx que esta
    // função devolve é o que garante o rastro persistente, via a linha
    // flow_engine_disparado do webhook.
    console.error(`[flow-engine] claim de idempotência falhou (${messageId}):`, claimError.message);
    await logEvent(tenantId, sessionId, "error", { messageId }, `claim de idempotência falhou: ${claimError.message}`);
    return "erro_claim";
  }
  if (!claim || claim.length === 0) {
    await logEvent(tenantId, sessionId, "flow_mensagem_repetida", { messageId });
    return "ja_processada";
  }

  // ── Passo 3.5: opt-out, antes de QUALQUER envio automático (inclusive o gate) ──
  const { data: optOut } = await supabase
    .from("whatsapp_opt_outs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone_e164", from)
    .maybeSingle();

  if (optOut) {
    await logEvent(tenantId, sessionId, "flow_opt_out_bloqueado", { messageId, telefone: from });
    return "opt_out";
  }

  // ── Passo 6 (parte 1): Flow ativo do número ──
  // Resolvido antes do passo 4 porque o cadastro do cliente grava
  // gate_iniciado_por_flow_id — sem Flow não há gate a iniciar, nem resposta
  // a dar.
  const { data: flow } = await supabase
    .from("whatsapp_flows")
    .select("id, tenant_id, mensagem_boas_vindas, mensagem_fallback")
    .eq("tenant_id", tenantId)
    .eq("cloud_credential_id", credencial.id)
    .eq("tipo", "keyword_automation")
    .eq("ativo", true)
    .is("deleted_at", null)
    .maybeSingle<Flow>();

  if (!flow) {
    await logEvent(tenantId, sessionId, "sem_flow_ativo", { messageId, phoneNumberId });
    return "sem_flow_ativo";
  }

  await supabase
    .from("flow_mensagens_processadas")
    .update({ flow_id: flow.id })
    .eq("tenant_id", tenantId)
    .eq("message_id", messageId);

  const contexto = { credencial, flow, tenantId, payload };

  // ── Passo 4: cliente ──
  const cliente = await obterOuCriarCliente(contexto);
  if (!cliente) return "erro_cliente";

  // ── Passo 5: gate de cadastro ──
  let textoParaAvaliar = payload.text;

  if (!cliente.cadastro_completo) {
    const resultadoGate = await conduzirGate(contexto, cliente);
    if (!resultadoGate.concluido) return resultadoGate.motivo;
    // Cadastro completou agora: a pergunta original (guardada em
    // mensagem_pendente) é respondida como se tivesse acabado de chegar.
    textoParaAvaliar = resultadoGate.mensagemPendente;
  }

  // ── Passos 6 e 7 ──
  return await responder(contexto, textoParaAvaliar, cliente);
}

// ─── Passo 4: busca/cria o cliente ───────────────────────────────────────────

async function obterOuCriarCliente(ctx: Contexto): Promise<Cliente | null> {
  const { tenantId, payload, credencial, flow } = ctx;

  const { data: existente } = await supabase
    .from("clientes")
    .select("id, nome, email, telefone, cadastro_completo, aguardando_campo, tentativas_campo_atual, pulou_cadastro, mensagem_pendente")
    .eq("tenant_id", tenantId)
    .eq("telefone", payload.from)
    .is("deleted_at", null)
    .maybeSingle<Cliente>();

  if (existente) return existente;

  // Telefone conhecido de QUALQUER campanha já disparada por este número
  // (não "a" campanha, no singular — um número roda várias ao longo do tempo).
  const { data: campanhas } = await supabase
    .from("campaigns")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("credential_id", credencial.id);

  let veioDeCampanha = false;
  if (campanhas && campanhas.length > 0) {
    const { data: destinatario } = await supabase
      .from("campaign_recipients")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone_e164", payload.from)
      .in("campaign_id", campanhas.map((c) => c.id))
      .limit(1)
      .maybeSingle();
    veioDeCampanha = Boolean(destinatario);
  }

  const novo: Record<string, unknown> = veioDeCampanha
    ? {
      tenant_id: tenantId,
      telefone: payload.from,
      origem: "campanha",
      cadastro_completo: true,
      aguardando_campo: null,
    }
    : {
      tenant_id: tenantId,
      telefone: payload.from,
      origem: "organico",
      cadastro_completo: false,
      aguardando_campo: "nome",
      mensagem_pendente: payload.text,
      gate_iniciado_por_flow_id: flow.id,
    };

  // Upsert com conflito em (tenant_id, telefone): duas mensagens quase
  // simultâneas do mesmo telefone não criam dois cadastros (rodada 2 do PRD).
  const { data: criado, error } = await supabase
    .from("clientes")
    .upsert(novo, { onConflict: "tenant_id,telefone", ignoreDuplicates: true })
    .select("id, nome, email, telefone, cadastro_completo, aguardando_campo, tentativas_campo_atual, pulou_cadastro, mensagem_pendente")
    .maybeSingle<Cliente>();

  if (error) {
    await logEvent(tenantId, payload.sessionId, "error", { messageId: payload.messageId }, `criação de cliente falhou: ${error.message}`);
    return null;
  }

  if (criado) return criado;

  // Perdeu a corrida do upsert: a linha existe, criada pela invocação vizinha.
  const { data: relido } = await supabase
    .from("clientes")
    .select("id, nome, email, telefone, cadastro_completo, aguardando_campo, tentativas_campo_atual, pulou_cadastro, mensagem_pendente")
    .eq("tenant_id", tenantId)
    .eq("telefone", payload.from)
    .maybeSingle<Cliente>();

  return relido ?? null;
}

// ─── Passo 5: gate de cadastro ───────────────────────────────────────────────

type ResultadoGate =
  | { concluido: true; mensagemPendente: string | null }
  | { concluido: false; motivo: string };

async function conduzirGate(ctx: Contexto, cliente: Cliente): Promise<ResultadoGate> {
  const { tenantId, payload, flow } = ctx;

  // Lock por telefone: "João" e "joao@x.com" mandados em sequência rápida
  // precisam ser avaliados em ordem, nunca a resposta de e-mail contra o
  // campo nome (rodada 3 do PRD).
  const { data: pegou } = await supabase.rpc("try_lock_gate", {
    p_tenant_id: tenantId,
    p_telefone: cliente.telefone,
    p_segundos: LOCK_SEGUNDOS,
  });

  if (!pegou) {
    // Não descarta: guarda o texto e sai. A invocação que tem o lock (ou a
    // próxima mensagem) retoma com nada perdido.
    if (payload.text) {
      await supabase
        .from("clientes")
        .update({ mensagem_pendente: concatenarPendente(cliente.mensagem_pendente, payload.text) })
        .eq("tenant_id", tenantId)
        .eq("id", cliente.id);
    }
    await logEvent(tenantId, payload.sessionId, "flow_gate_ocupado", { messageId: payload.messageId, telefone: cliente.telefone });
    return { concluido: false, motivo: "gate_ocupado" };
  }

  try {
    const campo = (cliente.aguardando_campo ?? "nome") as CampoGate;

    // Primeiro contato: o cliente acabou de ser criado com a pergunta guardada
    // em mensagem_pendente e ainda não recebeu a pergunta do gate.
    const primeiraVez = cliente.tentativas_campo_atual === 0 &&
      cliente.mensagem_pendente !== null &&
      campo === "nome" &&
      cliente.nome === null &&
      payload.text === cliente.mensagem_pendente;

    if (primeiraVez) {
      await enviar(ctx, perguntaDoCampo(campo));
      return { concluido: false, motivo: "gate_iniciado" };
    }

    // Mensagem não-texto durante o gate: reprompt, conta tentativa, mas nunca
    // é interpretada como resposta válida (rodada 2 do PRD).
    if (payload.type !== "text" || !payload.text || payload.text.trim().length === 0) {
      await enviar(ctx, TEXTOS.soTexto);
      return await registrarTentativaFalha(ctx, cliente, campo, null);
    }

    const validacao = validarCampo(campo, payload.text);

    if (!validacao.valido) {
      await enviar(ctx, reperguntaDoCampo(campo));
      return await registrarTentativaFalha(ctx, cliente, campo, payload.text);
    }

    // Campo válido: grava e avança.
    const seguinte = proximoCampo(campo);
    const atualizacao: Record<string, unknown> = {
      [campo]: validacao.valor,
      tentativas_campo_atual: 0,
      aguardando_campo: seguinte,
      cadastro_completo: seguinte === null,
    };

    await supabase.from("clientes").update(atualizacao).eq("tenant_id", tenantId).eq("id", cliente.id);

    if (seguinte) {
      await enviar(ctx, perguntaDoCampo(seguinte));
      return { concluido: false, motivo: "gate_em_andamento" };
    }

    return await concluirGate(ctx, cliente);
  } finally {
    await supabase.rpc("unlock_gate", { p_tenant_id: tenantId, p_telefone: cliente.telefone });
    await logEvent(tenantId, payload.sessionId, "flow_gate_passo", {
      messageId: payload.messageId,
      flowId: flow.id,
      telefone: cliente.telefone,
    });
  }
}

/**
 * Tentativa falha no campo atual. Na 2ª, avança com o campo nulo e marca
 * pulou_cadastro — nenhum campo trava a conversa pra sempre (é o risco de
 * LGPD/UX que a rodada 2 levantou). A mensagem que não validou é concatenada
 * em mensagem_pendente, nunca descartada.
 */
async function registrarTentativaFalha(
  ctx: Contexto,
  cliente: Cliente,
  campo: CampoGate,
  textoNaoValidado: string | null,
): Promise<ResultadoGate> {
  const { tenantId } = ctx;
  const tentativas = cliente.tentativas_campo_atual + 1;
  const pendente = textoNaoValidado
    ? concatenarPendente(cliente.mensagem_pendente, textoNaoValidado)
    : cliente.mensagem_pendente;

  if (tentativas < MAX_TENTATIVAS_POR_CAMPO) {
    await supabase
      .from("clientes")
      .update({ tentativas_campo_atual: tentativas, mensagem_pendente: pendente })
      .eq("tenant_id", tenantId)
      .eq("id", cliente.id);
    return { concluido: false, motivo: "gate_repergunta" };
  }

  // Degrade.
  const seguinte = proximoCampo(campo);
  await supabase
    .from("clientes")
    .update({
      tentativas_campo_atual: 0,
      pulou_cadastro: true,
      aguardando_campo: seguinte,
      cadastro_completo: seguinte === null,
      mensagem_pendente: pendente,
    })
    .eq("tenant_id", tenantId)
    .eq("id", cliente.id);

  if (seguinte) {
    await enviar(ctx, perguntaDoCampo(seguinte));
    return { concluido: false, motivo: "gate_degrade" };
  }

  return await concluirGate(ctx, { ...cliente, mensagem_pendente: pendente });
}

/** Cadastro completo (com ou sem degrade): recupera a pergunta original. */
async function concluirGate(ctx: Contexto, cliente: Cliente): Promise<ResultadoGate> {
  const { tenantId, payload } = ctx;

  const { data: atual } = await supabase
    .from("clientes")
    .select("mensagem_pendente")
    .eq("tenant_id", tenantId)
    .eq("id", cliente.id)
    .maybeSingle<{ mensagem_pendente: string | null }>();

  const pendente = atual?.mensagem_pendente ?? cliente.mensagem_pendente;

  await supabase
    .from("clientes")
    .update({ mensagem_pendente: null, cadastro_completo: true, aguardando_campo: null })
    .eq("tenant_id", tenantId)
    .eq("id", cliente.id);

  await logEvent(tenantId, payload.sessionId, "flow_gate_concluido", {
    messageId: payload.messageId,
    telefone: cliente.telefone,
  });

  return { concluido: true, mensagemPendente: pendente };
}

// ─── Passos 6 e 7: boas-vindas, keyword, fallback ────────────────────────────

async function responder(ctx: Contexto, texto: string | null, cliente: Cliente | null): Promise<string> {
  const { tenantId, flow, payload } = ctx;

  const { data: estado } = await supabase
    .from("flow_contato_estado")
    .select("id, recebeu_boas_vindas, fallbacks_consecutivos, pausado_aguardando_humano, updated_at")
    .eq("tenant_id", tenantId)
    .eq("flow_id", flow.id)
    .eq("contato_telefone", payload.from)
    .maybeSingle<ContatoEstado>();

  const inativoHaMuito = estado
    ? Date.now() - new Date(estado.updated_at).getTime() > DIAS_RESET_BOAS_VINDAS * 86_400_000
    : false;
  const deveDarBoasVindas = !estado || !estado.recebeu_boas_vindas || inativoHaMuito;

  if (deveDarBoasVindas && flow.mensagem_boas_vindas) {
    await enviar(ctx, flow.mensagem_boas_vindas);
  }

  // Boas-vindas é ADITIVA: nunca substitui a resposta à pergunta feita — o
  // mesmo turno segue para o match de keyword (rodada 1 do PRD).
  if (deveDarBoasVindas) {
    await salvarEstado(ctx, estado, {
      recebeu_boas_vindas: true,
      fallbacks_consecutivos: 0,
      pausado_aguardando_humano: false,
    });
  }

  // Retry do campo pulado (PRD, "Modelo de dados"): quem falhou duas vezes num
  // campo avançou com ele nulo e ficou marcado com pulou_cadastro. Na volta
  // por INATIVIDADE — não no primeiro contato, senão o gate reabriria logo
  // depois de degradar — o campo que faltou é perguntado mais uma vez, em vez
  // de a lacuna virar permanente.
  const ehResetPorInatividade = Boolean(estado) && inativoHaMuito;
  if (ehResetPorInatividade && cliente?.pulou_cadastro) {
    const reaberto = await reabrirGate(ctx, cliente, texto);
    if (reaberto) return reaberto;
  }

  // Pausa por excesso de fallback. NÃO é um "return" aqui: o PRD diz que "um
  // humano (ou uma keyword que bate depois) destrava" — então a comparação de
  // keyword continua acontecendo; o que a pausa suprime é o fallback, que é
  // justamente a mensagem repetida que motivou a pausa. Um reset de
  // boas-vindas (14 dias) também destrava, porque zerou o estado acima.
  const pausado = Boolean(estado?.pausado_aguardando_humano) && !deveDarBoasVindas;

  // Clique de botão de template nunca entra na comparação de texto: já é
  // tratado pelo módulo de campanhas (button_reply), e comparar geraria
  // resposta duplicada ou sem sentido.
  if (payload.type === "button" || payload.type === "interactive") {
    await logEvent(tenantId, payload.sessionId, "flow_clique_de_botao_ignorado", {
      messageId: payload.messageId,
      tipo: payload.type,
    });
    return deveDarBoasVindas ? "boas_vindas" : "clique_de_botao";
  }

  if (!texto || texto.trim().length === 0) {
    return deveDarBoasVindas ? "boas_vindas" : "sem_texto";
  }

  const { data: palavras } = await supabase
    .from("flow_palavras_chave")
    .select("id, palavra_chave, tipo_resposta, resposta, flow_destino_id")
    .eq("tenant_id", tenantId)
    .eq("flow_id", flow.id)
    .is("deleted_at", null);

  const encontrada = acharKeyword(texto, (palavras ?? []) as PalavraChave[]);

  if (encontrada) {
    if (encontrada.tipo_resposta === "abrir_flow") {
      const resultado = await abrirFlowNaConversa(ctx, encontrada.flow_destino_id);
      await zerarFallbacks(ctx, payload.from);
      return resultado;
    }

    if (encontrada.resposta) await enviar(ctx, encontrada.resposta);
    await zerarFallbacks(ctx, payload.from);
    return "keyword";
  }

  // Nenhuma keyword bateu e a conversa está pausada aguardando humano: só
  // captura. Repetir o mesmo fallback genérico é exatamente o que a pausa
  // existe pra impedir.
  if (pausado) {
    await logEvent(tenantId, payload.sessionId, "flow_pausado_aguardando_humano", {
      messageId: payload.messageId,
      telefone: payload.from,
    });
    return "pausado";
  }

  // Nenhuma keyword bateu → fallback.
  const consecutivos = (estado?.fallbacks_consecutivos ?? 0) + 1;
  if (flow.mensagem_fallback) await enviar(ctx, flow.mensagem_fallback);

  // Um evento por fallback (não só no 3º, que dispara o alerta): é a matéria-
  // prima do "o que caiu em fallback recentemente" na tela de Flows — o sinal
  // de que falta uma palavra-chave. O texto vai junto, truncado, porque a
  // revisão semanal precisa ler o que a pessoa perguntou sem abrir conversa
  // por conversa; `chatId` dá o link para a conversa quando faz falta.
  await logEvent(tenantId, payload.sessionId, "flow_fallback", {
    messageId: payload.messageId,
    flowId: flow.id,
    telefone: payload.from,
    texto: texto.slice(0, 300),
    chatId: await buscarChatId(payload.sessionId, payload.from),
    consecutivos,
  });

  const atingiuAlerta = consecutivos >= FALLBACKS_ATE_ALERTA;
  await salvarEstado(ctx, estado, {
    recebeu_boas_vindas: true,
    fallbacks_consecutivos: consecutivos,
    pausado_aguardando_humano: atingiuAlerta,
  });

  if (atingiuAlerta) {
    // Alertar e continuar mandando o mesmo fallback genérico não ajuda
    // ninguém: pausa até uma keyword bater ou um humano agir.
    await logEvent(tenantId, payload.sessionId, "flow_fallback_alerta", {
      messageId: payload.messageId,
      telefone: payload.from,
      flowId: flow.id,
      fallbacksConsecutivos: consecutivos,
    });
  }

  return atingiuAlerta ? "fallback_alerta" : "fallback";
}

/**
 * Reabre o gate para o campo que ficou nulo depois do degrade. Devolve o
 * resultado quando reabre, ou null quando não há o que perguntar.
 *
 * A pergunta original não se perde: vai para mensagem_pendente e é respondida
 * quando o cadastro completar, exatamente como no gate normal.
 */
async function reabrirGate(ctx: Contexto, cliente: Cliente, texto: string | null): Promise<string | null> {
  const { tenantId, payload } = ctx;

  // Dado apagado a pedido do titular (LGPD) nunca é pedido de novo — seria
  // reverter o direito que a pessoa exerceu.
  const { data: atual } = await supabase
    .from("clientes")
    .select("nome, email, pii_apagada_em, mensagem_pendente")
    .eq("tenant_id", tenantId)
    .eq("id", cliente.id)
    .maybeSingle<{ nome: string | null; email: string | null; pii_apagada_em: string | null; mensagem_pendente: string | null }>();

  if (!atual || atual.pii_apagada_em) return null;

  const faltante: CampoGate | null = atual.nome === null ? "nome" : (atual.email === null ? "email" : null);
  if (!faltante) return null;

  await supabase
    .from("clientes")
    .update({
      cadastro_completo: false,
      aguardando_campo: faltante,
      tentativas_campo_atual: 0,
      mensagem_pendente: texto
        ? concatenarPendente(atual.mensagem_pendente, texto)
        : atual.mensagem_pendente,
    })
    .eq("tenant_id", tenantId)
    .eq("id", cliente.id);

  await enviar(ctx, perguntaDoCampo(faltante));
  await logEvent(tenantId, payload.sessionId, "flow_gate_reaberto", {
    messageId: payload.messageId,
    telefone: cliente.telefone,
    campo: faltante,
  });

  return "gate_reaberto";
}

/**
 * Abre um Flow publicado dentro da conversa (tipo_resposta='abrir_flow').
 *
 * Depende de o Flow de destino ter `meta_flow_id` — o ID do Flow publicado na
 * Meta (migration 0028). Sem ele não há o que abrir: cadastro incompleto, não
 * falha de envio, e por isso o evento é específico.
 */
async function abrirFlowNaConversa(ctx: Contexto, flowDestinoId: string | null): Promise<string> {
  const { tenantId, credencial, payload, flow } = ctx;

  if (!flowDestinoId) {
    await logEvent(tenantId, payload.sessionId, "flow_abrir_sem_destino", {
      messageId: payload.messageId,
      flowId: flow.id,
    });
    return "abrir_flow_sem_destino";
  }

  const { data: destino } = await supabase
    .from("whatsapp_flows")
    .select("id, nome, meta_flow_id, meta_flow_cta")
    .eq("tenant_id", tenantId)
    .eq("id", flowDestinoId)
    .eq("ativo", true)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; nome: string; meta_flow_id: string | null; meta_flow_cta: string | null }>();

  if (!destino?.meta_flow_id) {
    await logEvent(tenantId, payload.sessionId, "flow_abrir_sem_meta_flow_id", {
      messageId: payload.messageId,
      flowDestinoId,
    });
    return "abrir_flow_sem_meta_id";
  }

  // flow_token identifica ESTA abertura: vai e volta em toda requisição do
  // endpoint, e é o que liga a interação à conversa quando for preciso
  // depurar.
  const flowToken = `${destino.id}:${payload.messageId}`.slice(0, 100);

  const resultado = await enviarFlow({
    phoneNumberId: credencial.phone_number_id,
    accessToken: credencial.access_token,
    to: payload.from,
    flowId: destino.meta_flow_id,
    flowToken,
    cta: destino.meta_flow_cta ?? "Ver agenda",
    corpo: destino.nome,
  });

  if (!resultado.ok) {
    const codigo = resultado.errorCode ?? -1;
    const evento = MESSAGING_LIMIT_CODES.has(codigo)
      ? "flow_reply_tier_limit"
      : codigo === FORA_DA_JANELA_CODE
      ? "flow_reply_fora_da_janela"
      : "flow_reply_erro";
    await logEvent(tenantId, payload.sessionId, evento, {
      messageId: payload.messageId,
      telefone: payload.from,
      flowDestinoId,
      errorCode: resultado.errorCode,
      status: resultado.status,
    }, resultado.errorMessage);
    return "abrir_flow_falhou";
  }

  await logEvent(tenantId, payload.sessionId, "flow_aberto_na_conversa", {
    messageId: payload.messageId,
    wamid: resultado.wamid,
    metaFlowId: destino.meta_flow_id,
    flowToken,
  });

  return "abrir_flow";
}

async function zerarFallbacks(ctx: Contexto, telefone: string): Promise<void> {
  const { tenantId, flow } = ctx;
  await supabase
    .from("flow_contato_estado")
    .upsert({
      tenant_id: tenantId,
      flow_id: flow.id,
      contato_telefone: telefone,
      recebeu_boas_vindas: true,
      fallbacks_consecutivos: 0,
      pausado_aguardando_humano: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "flow_id,contato_telefone" });
}

async function salvarEstado(
  ctx: Contexto,
  _estado: ContatoEstado | null,
  campos: Record<string, unknown>,
): Promise<void> {
  const { tenantId, flow, payload } = ctx;
  const { error } = await supabase
    .from("flow_contato_estado")
    .upsert({
      tenant_id: tenantId,
      flow_id: flow.id,
      contato_telefone: payload.from,
      updated_at: new Date().toISOString(),
      ...campos,
    }, { onConflict: "flow_id,contato_telefone" });

  if (error) {
    await logEvent(tenantId, payload.sessionId, "error", { messageId: payload.messageId }, `flow_contato_estado upsert falhou: ${error.message}`);
  }
}

// ─── Passos 8 e 9: envio + histórico ─────────────────────────────────────────

async function enviar(ctx: Contexto, texto: string): Promise<void> {
  const { credencial, tenantId, payload, flow } = ctx;

  const resultado = await enviarTexto({
    phoneNumberId: credencial.phone_number_id,
    accessToken: credencial.access_token,
    to: payload.from,
    body: texto,
  });

  if (!resultado.ok) {
    const codigo = resultado.errorCode ?? -1;
    const evento = MESSAGING_LIMIT_CODES.has(codigo)
      ? "flow_reply_tier_limit"
      : codigo === FORA_DA_JANELA_CODE
      ? "flow_reply_fora_da_janela"
      : "flow_reply_erro";

    // Teto de tier nunca é retry cego (mesmo tratamento do campaign-sender):
    // logar e desistir desta resposta.
    await logEvent(tenantId, payload.sessionId, evento, {
      messageId: payload.messageId,
      telefone: payload.from,
      flowId: flow.id,
      errorCode: resultado.errorCode,
      status: resultado.status,
    }, resultado.errorMessage);
    return;
  }

  // Passo 9: a resposta automática também é histórico.
  const chatId = await buscarChatId(payload.sessionId, payload.from);

  const { error: msgError } = await supabase.from("messages").insert({
    tenant_id: tenantId,
    session_id: payload.sessionId,
    chat_id: chatId,
    message_id: resultado.wamid,
    from_me: true,
    type: "text",
    body: texto,
    timestamp: new Date().toISOString(),
    raw_payload: { origem: "flow-engine", flowId: flow.id, respostaA: payload.messageId },
  });

  if (msgError) {
    await logEvent(tenantId, payload.sessionId, "error", { wamid: resultado.wamid }, `insert da resposta em messages falhou: ${msgError.message}`);
  }

  await logEvent(tenantId, payload.sessionId, "flow_reply_sent", {
    messageId: payload.messageId,
    wamid: resultado.wamid,
    flowId: flow.id,
    telefone: payload.from,
  });
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Chat da conversa (mesma sessão + telefone). Null se ainda não existir. */
async function buscarChatId(sessionId: string, jid: string): Promise<string | null> {
  const { data } = await supabase
    .from("chats")
    .select("id")
    .eq("session_id", sessionId)
    .eq("jid", jid)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

interface Contexto {
  credencial: Credencial;
  flow: Flow;
  tenantId: string;
  payload: FlowEngineRequest;
}

async function logEvent(
  tenantId: string | null,
  sessionId: string | null,
  eventType: string,
  payload: unknown,
  error?: string,
): Promise<void> {
  const { error: logError } = await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    event_type: eventType,
    payload,
    error: error ?? null,
  });
  if (logError) console.error("[flow-engine] events_log insert falhou:", logError.message);
}
