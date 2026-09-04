// Webhook do WhatsApp Cloud API (oficial) — separado de whatsapp-webhook
// (Evolution/Baileys), zero código em comum além de events_log. GET
// responde o handshake de assinatura do Meta; POST recebe dois tipos de
// evento: status de entrega de campanha (sent/delivered/read/failed, por
// wamid) e mensagens inbound (respostas de contato), que caem na mesma
// caixa de entrada compartilhada (chats/messages) usada pelo pipeline
// Evolution — ver docs/plans ou CLAUDE.md, seção "Módulo de campanhas".
// verify_jwt=false — chamada pelo Meta, sem Authorization Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")!;

// Guarda de precedência: nunca sobrescrever um status "mais avançado" com um
// evento atrasado que chegue fora de ordem (o Meta não garante ordem de
// entrega dos eventos de status).
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1, // terminal, mas não "mais avançado" que delivered/read
};

interface CloudInboundMessage {
  from: string; // E.164 puro, sem sufixo (ex: "5541999999999")
  id: string; // wamid
  timestamp: string;
  type: string; // text|image|audio|video|document|sticker|location|button|interactive|...
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string };
  button?: { text: string; payload?: string }; // clique em quick-reply de template legado
  interactive?: {
    type: string; // button_reply|list_reply
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  context?: { id: string; from?: string }; // id = wamid da mensagem original (respostas/cliques)
}

// Texto exato do(s) botão(ões) que o negócio usa como "sair da lista" em
// templates de campanha — comparado case-insensitive/trim contra o texto
// do botão clicado. Adicionar novas frases aqui conforme surgirem outros
// templates com botão de opt-out com texto diferente.
const OPT_OUT_BUTTON_TEXTS = new Set(
  ["Parar de receber mensagens"].map((t) => t.trim().toLowerCase()),
);

// Sinais de proteção de qualidade/spam da Meta que chegam de forma
// ASSÍNCRONA (webhook de status, não na resposta síncrona do envio) —
// diferente de MESSAGING_LIMIT_CODES em campaign-sender, que só cobre
// rejeição síncrona. Achado em produção (07/08/2026, confirmado com código
// numérico em 07/08/2026 numa segunda campanha): 131048 = "Spam Rate limit
// hit", 131049 = "This message was not delivered to maintain healthy
// ecosystem engagement." — o mesmo 131048 já existe em
// campaign-sender.MESSAGING_LIMIT_CODES para rejeição síncrona; aqui é o
// caminho assíncrono, que não tinha nenhuma proteção antes (a campanha
// continuava queimando destinatários contra a parede: 76-92% de falha nos
// minutos seguintes ao primeiro sinal, numa campanha real de 5043).
// Match por código quando presente (mais confiável); texto como fallback
// pra qualquer variante ainda não catalogada.
const ASYNC_QUALITY_PROTECTION_CODES = new Set([131048, 131049]);
const ASYNC_QUALITY_PROTECTION_PHRASES = [
  "spam rate limit",
  "healthy ecosystem engagement",
];

function isAsyncQualityProtectionError(code: number | undefined, title: string | undefined): boolean {
  if (code && ASYNC_QUALITY_PROTECTION_CODES.has(code)) return true;
  if (!title) return false;
  const lower = title.toLowerCase();
  return ASYNC_QUALITY_PROTECTION_PHRASES.some((p) => lower.includes(p));
}

interface CloudContact {
  profile?: { name?: string };
  wa_id: string;
}

interface CloudWebhookPayload {
  entry?: {
    id: string;
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id?: string };
        statuses?: {
          id: string; // wamid
          status: string; // sent|delivered|read|failed
          timestamp: string;
          errors?: { code: number; title: string }[];
        }[];
        messages?: CloudInboundMessage[];
        contacts?: CloudContact[];
      };
    }[];
  }[];
}

// Mesmo vocabulário de messages.type usado no whatsapp-webhook (Evolution)
// — replicado aqui, não importado, porque as duas Deno functions são
// deploys independentes sem módulo compartilhado.
const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);
function normalizeCloudMessageType(type: string): string {
  const known = new Set(["text", "image", "audio", "video", "document", "sticker", "location", "contacts", "reaction", "interactive", "button"]);
  return known.has(type) ? type : "unknown";
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("X-Hub-Signature-256") ?? "";

  if (!(await verifySignature(rawBody, signature))) {
    await logEvent(null, "error", null, "Invalid X-Hub-Signature-256");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: CloudWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Responder 200 imediatamente — processamento é best-effort, mesmo padrão
  // do whatsapp-webhook (Evolution).
  const responsePromise = processEvent(body);
  responsePromise.catch((err) => {
    console.error("Unhandled cloud webhook error:", err);
  });

  return new Response("ok", { status: 200 });
});

async function verifySignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice(7);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function processEvent(body: CloudWebhookPayload): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      for (const status of change.value.statuses ?? []) {
        await handleStatus(status);
      }

      for (const message of change.value.messages ?? []) {
        // entry.id é o WABA ID — usado como fallback de resolução de tenant
        // quando o phone_number_id não tem credencial cadastrada (ver
        // resolveInboundTarget).
        await handleInboundMessage(message, change.value.metadata?.phone_number_id, change.value.contacts, entry.id);
      }
    }
  }
}

// ─── Mensagem inbound (resposta de contato) → caixa de entrada compartilhada ──

async function handleInboundMessage(
  message: CloudInboundMessage,
  phoneNumberId: string | undefined,
  contacts: CloudContact[] | undefined,
  wabaId: string | undefined,
): Promise<void> {
  if (!phoneNumberId) {
    await logEvent(null, "error", { messageId: message.id }, "inbound message sem phone_number_id no metadata");
    return;
  }

  const target = await resolveInboundTarget(phoneNumberId, wabaId, message.id);
  if (!target) return; // resolveInboundTarget já logou o motivo

  const { sessionId, tenantId, viaFallbackWaba: usouFallbackDeWaba } = target;
  const jid = message.from; // E.164 puro — ver fix em apps/web/lib/chat-display.ts
  const pushName = contacts?.[0]?.profile?.name ?? null;
  const type = normalizeCloudMessageType(message.type);

  // Upsert contato
  const { data: contact } = await supabase
    .from("contacts")
    .upsert({ tenant_id: tenantId, jid, push_name: pushName, is_group: false }, { onConflict: "tenant_id,jid" })
    .select("id")
    .single();

  // Upsert chat em dois passos — mesmo padrão de whatsapp-webhook (Evolution):
  // insert-if-absent primeiro pra nunca sobrescrever um nome já resolvido.
  await supabase
    .from("chats")
    .upsert(
      { tenant_id: tenantId, session_id: sessionId, contact_id: contact?.id ?? null, jid, name: pushName ?? jid },
      { onConflict: "session_id,jid", ignoreDuplicates: true },
    );

  const buttonText = extractButtonText(message);
  const body = message.text?.body ?? extractCaption(message) ?? buttonText ?? (MEDIA_TYPES.has(type) ? `[${type}]` : null);

  const { data: chat } = await supabase
    .from("chats")
    .update({
      last_message_at: new Date(Number(message.timestamp) * 1000).toISOString(),
      ...(body ? { last_message_body: body } : {}),
      ...(contact?.id ? { contact_id: contact.id } : {}),
      ...(pushName ? { name: pushName } : {}),
    })
    .eq("session_id", sessionId)
    .eq("jid", jid)
    .select("id")
    .single();

  const { data: savedMessage, error: msgError } = await supabase
    .from("messages")
    .upsert({
      tenant_id: tenantId,
      session_id: sessionId,
      chat_id: chat?.id ?? null,
      contact_id: contact?.id ?? null,
      message_id: message.id,
      from_me: false,
      type,
      body,
      timestamp: new Date(Number(message.timestamp) * 1000).toISOString(),
      raw_payload: message,
    }, { onConflict: "session_id,message_id" })
    .select("id")
    .single();

  if (msgError) {
    await logEvent(tenantId, "error", { sessionId, messageId: message.id }, `messages.upsert: ${msgError.message}`);
    return;
  }

  // Mesmos três side-effects disparados pelo whatsapp-webhook (Evolution) pra
  // toda mensagem inbound — sem eles, respostas via Cloud API apareciam na
  // caixa de entrada mas nunca acionavam Alertas, busca semântica ou
  // integrações externas via webhook, contrariando o objetivo de reaproveitar
  // "chat-view, busca, alertas" em vez de uma tela separada.
  if (savedMessage?.id && body && body.trim().length > 0) {
    if (type === "text") {
      triggerEmbeddingGeneration({ messageId: savedMessage.id, body, tenantId, messageType: type });
    }
    checkAlerts(tenantId, sessionId, savedMessage.id, body);
  }

  if (savedMessage?.id) {
    fetch(`${SUPABASE_URL}/functions/v1/webhook-delivery`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        tenantId,
        event: "message.received",
        payload: { messageId: savedMessage.id, chatId: chat?.id ?? null, fromMe: false, type, body },
      }),
    }).catch(() => {});
  }

  // Motor de automação por Flow — função separada, invocada só depois de a
  // mensagem já estar salva (se ela falhar, a captura não se perde).
  //
  // NÃO é fire-and-forget (exigência explícita do PRD): grava
  // flow_engine_disparado ANTES de invocar e volta pra completar a mesma linha
  // com o erro se a invocação falhar. Sem isso, uma falha depois do 200 pro
  // Meta não deixaria rastro nenhum.
  //
  // Só invoca quando o número tem credencial própria: sessão vinda do fallback
  // por WABA (cloud_credential_id null) captura, mas nunca responde
  // automaticamente.
  if (savedMessage?.id && !usouFallbackDeWaba) {
    await dispararFlowEngine({
      tenantId,
      sessionId,
      messageId: message.id,
      phoneNumberId,
      from: jid,
      text: message.text?.body ?? null,
      type,
    });
  }

  // Mídia inbound do Cloud API: download binário não suportado na v1
  // (fluxo de download é totalmente diferente do Evolution — media_id +
  // GET /{media_id} autenticado). Registra o metadata, preserva
  // raw_payload pra reprocessamento futuro, sem baixar o arquivo.
  if (MEDIA_TYPES.has(type) && savedMessage?.id) {
    const mediaMeta = (message as unknown as Record<string, { mime_type?: string }>)[type];
    // media_files não tem coluna de erro — o motivo ("ainda não suportado",
    // não "falhou de verdade") fica só no events_log abaixo.
    await supabase.from("media_files").insert({
      tenant_id: tenantId,
      message_id: savedMessage.id,
      mime_type: mediaMeta?.mime_type ?? "application/octet-stream",
      download_status: "failed",
    });
  }

  await logEvent(tenantId, "inbound_cloud_message", {
    sessionId,
    messageId: savedMessage?.id,
    type,
    ...(MEDIA_TYPES.has(type) ? { mediaDownload: "cloud_api_media_not_yet_supported" } : {}),
  });

  if (buttonText) {
    // Liga o clique de volta ao destinatário exato da campanha via
    // context.id (wamid da mensagem original) — funciona pra qualquer
    // botão de qualquer template, sem precisar hardcodar texto. Alimenta
    // o CSV de Relatório (GET /api/campaigns/[id]/recipients).
    if (message.context?.id) {
      await linkButtonReplyToRecipient(message.context.id, buttonText);
    }
    if (OPT_OUT_BUTTON_TEXTS.has(buttonText.trim().toLowerCase())) {
      await registerOptOut(tenantId, jid, buttonText);
    }
  }
}

function extractCaption(message: CloudInboundMessage): string | null {
  return message.image?.caption ?? message.video?.caption ?? message.document?.caption ?? null;
}

// Cobre os dois formatos de clique em botão que o Cloud API manda: quick
// reply de template legado (`message.button.text`) e o formato interactive
// mais novo (`message.interactive.button_reply.title` — list_reply também,
// por segurança, embora templates de campanha não usem list).
function extractButtonText(message: CloudInboundMessage): string | null {
  return message.button?.text
    ?? message.interactive?.button_reply?.title
    ?? message.interactive?.list_reply?.title
    ?? null;
}

async function linkButtonReplyToRecipient(originalWamid: string, buttonText: string): Promise<void> {
  const { error } = await supabase
    .from("campaign_recipients")
    .update({ button_reply: buttonText, button_reply_at: new Date().toISOString() })
    .eq("wamid", originalWamid);

  // Sem erro de "not found" — a maioria dos cliques não é resposta a uma
  // campanha (conversa normal também gera context.id ao responder alguém),
  // então 0 linhas afetadas é o caso comum, não uma falha.
  if (error) {
    await logEvent(null, "error", { originalWamid }, `campaign_recipients button_reply update: ${error.message}`);
  }
}

async function registerOptOut(tenantId: string, phoneE164: string, buttonText: string): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_opt_outs")
    .upsert(
      { tenant_id: tenantId, phone_e164: phoneE164, reason: `Botão de template: "${buttonText}"` },
      { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true },
    );

  if (error) {
    await logEvent(tenantId, "error", { phoneE164 }, `whatsapp_opt_outs upsert: ${error.message}`);
    return;
  }

  await logEvent(tenantId, "opt_out_registered", { phoneE164, buttonText });
}

async function handleStatus(status: {
  id: string;
  status: string;
  timestamp: string;
  errors?: { code: number; title: string }[];
}): Promise<void> {
  const { data: recipient, error: findError } = await supabase
    .from("campaign_recipients")
    .select("id, tenant_id, campaign_id, status")
    .eq("wamid", status.id)
    .maybeSingle();

  if (findError) {
    await logEvent(null, "error", { wamid: status.id }, `campaign_recipients lookup: ${findError.message}`);
    return;
  }

  if (!recipient) {
    // wamid não corresponde a nenhuma campanha conhecida — pode ser evento
    // duplicado após a campanha ser limpa, ou mensagem fora deste módulo.
    return;
  }

  const newStatus = status.status; // sent|delivered|read|failed
  const currentRank = STATUS_RANK[recipient.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  // Guarda de precedência: só aplica se for um avanço real, exceto 'failed'
  // que sempre é registrado (mas não regride um status já avançado).
  if (newStatus !== "failed" && newRank <= currentRank) {
    await logEvent(recipient.tenant_id, "campaign_status_event", {
      campaignId: recipient.campaign_id,
      recipientId: recipient.id,
      wamid: status.id,
      status: newStatus,
      ignored: true,
      reason: "stale_or_duplicate",
    });
    return;
  }
  if (newStatus === "failed" && currentRank >= STATUS_RANK.delivered) {
    // Já foi entregue/lido — um "failed" atrasado não regride isso.
    await logEvent(recipient.tenant_id, "campaign_status_event", {
      campaignId: recipient.campaign_id,
      recipientId: recipient.id,
      wamid: status.id,
      status: newStatus,
      ignored: true,
      reason: "already_delivered",
    });
    return;
  }

  const timestampIso = new Date(Number(status.timestamp) * 1000).toISOString();
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "delivered") update.delivered_at = timestampIso;
  if (newStatus === "read") update.read_at = timestampIso;
  if (newStatus === "failed") {
    update.failed_at = timestampIso;
    update.error = status.errors?.[0]?.title ?? "delivery failed";
  }

  const { error: updateError } = await supabase.from("campaign_recipients").update(update).eq("id", recipient.id);
  if (updateError) {
    await logEvent(recipient.tenant_id, "error", { recipientId: recipient.id }, `campaign_recipients update: ${updateError.message}`);
    return;
  }

  await supabase.rpc("recompute_campaign_counters", { p_campaign_id: recipient.campaign_id });

  const errorTitle = status.errors?.[0]?.title;
  const errorCode = status.errors?.[0]?.code;

  await logEvent(recipient.tenant_id, "campaign_status_event", {
    campaignId: recipient.campaign_id,
    recipientId: recipient.id,
    wamid: status.id,
    status: newStatus,
    ...(errorCode ? { errorCode } : {}),
    ...(errorTitle ? { errorTitle } : {}),
  });

  // Pausa automática: proteção de qualidade/spam assíncrona da Meta não é
  // por-destinatário, é sinal de que a campanha inteira precisa parar —
  // continuar mandando contra a parede só piora (visto em produção: 76-92%
  // de falha nos minutos seguintes ao primeiro sinal). Pausa na primeira
  // ocorrência em vez de esperar acumular várias.
  if (newStatus === "failed" && isAsyncQualityProtectionError(errorCode, errorTitle)) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", recipient.campaign_id)
      .single();

    if (campaign?.status === "sending") {
      await supabase
        .from("campaigns")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", recipient.campaign_id);
      await logEvent(recipient.tenant_id, "campaign_paused", {
        campaignId: recipient.campaign_id,
        reason: "async_quality_protection",
        errorCode,
        errorTitle,
      });
    }
  }
}

// ─── Trigger assíncrono do generate-embeddings (mesmo padrão do whatsapp-webhook) ──

interface EmbeddingTriggerPayload {
  messageId: string;
  body: string;
  tenantId: string;
  messageType: string;
}

function triggerEmbeddingGeneration(payload: EmbeddingTriggerPayload): void {
  fetch(`${SUPABASE_URL}/functions/v1/generate-embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to trigger generate-embeddings:", err));
}

// ─── Verificação de alertas (keyword — mesmo padrão do whatsapp-webhook) ───────

interface AlertRow {
  id: string;
  keywords: string[];
  session_id: string | null;
}

function checkAlerts(tenantId: string, sessionId: string, messageId: string, body: string): void {
  (async () => {
    const { data: alerts } = await supabase
      .from("alerts")
      .select("id, keywords, session_id")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    if (!alerts || alerts.length === 0) return;

    const lowerBody = body.toLowerCase();

    for (const alert of alerts as AlertRow[]) {
      if (alert.session_id && alert.session_id !== sessionId) continue;

      for (const keyword of alert.keywords) {
        if (lowerBody.includes(keyword.toLowerCase())) {
          await supabase.from("alert_events").insert({
            tenant_id: tenantId,
            alert_id: alert.id,
            message_id: messageId,
            matched_keyword: keyword,
            seen: false,
          });
          break;
        }
      }
    }
  })().catch((err) => console.error("checkAlerts error:", err));
}

// ─── Invocação do flow-engine (passo 3 do fluxo técnico do PRD) ──────────────
//
// Deliberadamente NÃO é fire-and-forget. Grava flow_engine_disparado antes de
// chamar e volta pra completar a MESMA linha com o erro se a chamada falhar —
// o webhook já respondeu 200 pro Meta nesse ponto, então sem esse rastro uma
// falha de invocação seria invisível (mesmo espírito da regra 6 do CLAUDE.md,
// aplicado à invocação, não só aos inserts de dentro dela).
//
// O await não atrasa a resposta ao Meta: processEvent roda depois do 200.
async function dispararFlowEngine(params: {
  tenantId: string;
  sessionId: string;
  messageId: string;
  phoneNumberId: string;
  from: string;
  text: string | null;
  type: string;
}): Promise<void> {
  const { tenantId, sessionId, messageId, phoneNumberId, from, text, type } = params;

  const { data: evento } = await supabase
    .from("events_log")
    .insert({
      tenant_id: tenantId,
      session_id: sessionId,
      event_type: "flow_engine_disparado",
      payload: { messageId, phoneNumberId, telefone: from, tipo: type },
    })
    .select("id")
    .maybeSingle();

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/flow-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messageId, phoneNumberId, from, text, type, sessionId }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok && evento?.id) {
      const corpo = await response.text().catch(() => "");
      await supabase
        .from("events_log")
        .update({ error: `flow-engine respondeu ${response.status}: ${corpo.slice(0, 300)}` })
        .eq("id", evento.id);
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    if (evento?.id) {
      await supabase
        .from("events_log")
        .update({ error: `invocação do flow-engine falhou: ${mensagem}` })
        .eq("id", evento.id);
    }
    console.error("[cloud-webhook] invocação do flow-engine falhou:", mensagem);
  }
}

// ─── Resolução do destino de uma mensagem inbound ────────────────────────────
//
// Caminho normal: phone_number_id → credencial ativa → wa_sessions.
//
// Fallback (04/09/2026): a assinatura de webhook do Meta é por App/WABA, não
// por número — todo número da WABA entrega no mesmo endpoint, inclusive os que
// ninguém cadastrou em whatsapp_cloud_credentials. Até aqui essas mensagens
// eram descartadas com um log de erro e nada mais: 160 mensagens perdidas
// entre 07/08 e 04/09/2026, em 3 números da WABA 1417914842914678 que estavam
// CONNECTED no Meta mas ausentes da tabela. Perder o raw_payload contraria a
// regra 2 do CLAUDE.md, e o produto inteiro existe pra não perder conversa.
//
// Agora: sem credencial pro número, resolve o tenant pelo waba_id (entry.id do
// payload) e salva a mensagem numa sessão de acolhimento (cloud_credential_id
// null, status 'disconnected' — que é a verdade: o número não está
// configurado). Nada de auto-provisionar credencial copiando o access_token de
// um vizinho de WABA: espalharia cópia de token por N linhas e transformaria
// um erro de configuração em algo invisível. O objetivo é não perder a
// mensagem, não fingir que está tudo certo.
//
// Regra pro flow-engine (Sprint A1): número que caiu neste fallback captura,
// mas NUNCA responde automaticamente — responder por um número que ninguém
// configurou é pior que silêncio. É o caso anterior ao "sem Flow ativo" do PRD.
interface InboundTarget {
  sessionId: string;
  tenantId: string;
  // true quando o número não tem credencial própria e o tenant veio pelo
  // waba_id. Quem consome usa isso para capturar sem responder.
  viaFallbackWaba: boolean;
}

async function resolveInboundTarget(
  phoneNumberId: string,
  wabaId: string | undefined,
  messageId: string,
): Promise<InboundTarget | null> {
  const { data: credential, error: credError } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("id, tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle();

  if (credError) {
    await logEvent(null, "error", { phoneNumberId, messageId }, credError.message);
    return null;
  }

  if (credential) {
    const { data: session, error: sessionError } = await supabase
      .from("wa_sessions")
      .select("id, tenant_id")
      .eq("cloud_credential_id", credential.id)
      .maybeSingle();

    if (sessionError || !session) {
      await logEvent(credential.tenant_id, "error", { phoneNumberId, messageId }, sessionError?.message ?? "no wa_sessions row for cloud_credential_id");
      return null;
    }
    return { sessionId: session.id, tenantId: session.tenant_id, viaFallbackWaba: false };
  }

  // ── Fallback por WABA ──
  if (!wabaId) {
    await logEvent(null, "error", { phoneNumberId, messageId }, "no active credential for phone_number_id (e sem waba_id no payload)");
    return null;
  }

  const { data: wabaCredentials, error: wabaError } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("tenant_id")
    .eq("waba_id", wabaId)
    .eq("active", true);

  if (wabaError) {
    await logEvent(null, "error", { phoneNumberId, wabaId, messageId }, wabaError.message);
    return null;
  }

  const tenantIds = [...new Set((wabaCredentials ?? []).map((c) => c.tenant_id as string))];

  if (tenantIds.length === 0) {
    await logEvent(null, "error", { phoneNumberId, wabaId, messageId }, "no active credential for phone_number_id nem para o waba_id");
    return null;
  }

  // Hoje uma WABA pertence a um único tenant, mas não há constraint garantindo
  // isso. Ambíguo = não adivinha: salvar no tenant errado é pior que não
  // salvar (regra de isolamento entre tenants).
  if (tenantIds.length > 1) {
    await logEvent(null, "credential_ambiguous_waba", { phoneNumberId, wabaId, messageId, tenantIds }, "waba_id resolve para mais de um tenant — mensagem não salva");
    return null;
  }

  const tenantId = tenantIds[0];
  const sessionId = await ensureUnregisteredNumberSession(tenantId, phoneNumberId, wabaId);
  if (!sessionId) {
    await logEvent(tenantId, "error", { phoneNumberId, wabaId, messageId }, "falha ao criar sessão de acolhimento para número sem credencial");
    return null;
  }

  await logEvent(tenantId, "credential_missing_but_waba_known", { phoneNumberId, wabaId, messageId, sessionId });
  return { sessionId, tenantId, viaFallbackWaba: true };
}

// Sessão de acolhimento por número desconhecido. messages.session_id é NOT NULL,
// então salvar a mensagem exige uma sessão; wa_sessions.cloud_credential_id é
// nullable, o que permite representar "número sem credencial" sem inventar uma.
// Idempotente: conflito em (tenant_id, phone_number).
async function ensureUnregisteredNumberSession(
  tenantId: string,
  phoneNumberId: string,
  wabaId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("wa_sessions")
    .upsert({
      tenant_id: tenantId,
      phone_number: phoneNumberId,
      label: `Número não cadastrado (WABA ${wabaId})`,
      status: "disconnected",
      channel: "cloud_api",
      cloud_credential_id: null,
    }, { onConflict: "tenant_id,phone_number" })
    .select("id")
    .single();

  if (error) {
    console.error("[cloud-webhook] upsert da sessão de acolhimento falhou:", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function logEvent(
  tenantId: string | null,
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
