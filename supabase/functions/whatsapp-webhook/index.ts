import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const aKey = await crypto.subtle.importKey("raw", aBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bKey = await crypto.subtle.importKey("raw", bBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = encoder.encode("compare");
  const [aSig, bSig] = await Promise.all([
    crypto.subtle.sign("HMAC", aKey, msg),
    crypto.subtle.sign("HMAC", bKey, msg),
  ]);
  const aView = new Uint8Array(aSig);
  const bView = new Uint8Array(bSig);
  let diff = 0;
  for (let i = 0; i < aView.length; i++) diff |= aView[i] ^ bView[i];
  return diff === 0;
}

// ─── Tipos básicos do payload Evolution ───────────────────────────────────────

interface EvolutionEvent {
  event: string;
  instance: string;
  data: Record<string, unknown>;
}

interface MessageData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message: Record<string, unknown>;
  messageType: string;
  messageTimestamp: number;
  pushName?: string;
  broadcast?: boolean;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  webhook_secret: string | null;
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: EvolutionEvent;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { data: session } = await supabase
    .from("wa_sessions")
    .select("id, tenant_id, webhook_secret")
    .eq("evolution_instance_name", body.instance)
    .single<SessionRow>();

  if (!session) {
    await logEvent(null, null, "error", { instance: body.instance }, `Session not found for instance: ${body.instance}`);
    return new Response("Unauthorized", { status: 401 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const secret = session.webhook_secret ?? "";
  const valid = secret.length > 0 && await timingSafeEqual(token, secret);

  if (!valid) {
    await logEvent(session.tenant_id, session.id, "error", null, "Invalid webhook secret");
    return new Response("Unauthorized", { status: 401 });
  }

  // Retornar 200 imediatamente — processamento é best-effort
  const responsePromise = processEvent(body, session);
  responsePromise.catch(async (err) => {
    console.error("Unhandled webhook error:", err);
    await logEvent(null, null, "error", { event: body.event, instance: body.instance }, String(err));
  });

  return new Response("ok", { status: 200 });
});

// ─── Roteamento de eventos ────────────────────────────────────────────────────

async function processEvent(body: EvolutionEvent, session: SessionRow): Promise<void> {
  const { event, instance, data } = body;
  const { id: sessionId, tenant_id: tenantId } = session;

  await logEvent(tenantId, sessionId, "webhook_received", { event, instance });

  switch (event) {
    case "messages.upsert":
      await handleMessagesUpsert(tenantId, sessionId, instance, data);
      break;
    case "messages.update":
      await handleMessagesUpdate(tenantId, sessionId, data);
      break;
    case "messages.delete":
      await handleMessagesDelete(tenantId, sessionId, data);
      break;
    case "connection.update":
      await handleConnectionUpdate(tenantId, sessionId, data);
      break;
    case "qrcode.updated":
      await handleQrcodeUpdated(tenantId, sessionId, data);
      break;
    default:
      break;
  }
}

// ─── messages.upsert ─────────────────────────────────────────────────────────

async function handleMessagesUpsert(
  tenantId: string,
  sessionId: string,
  instance: string,
  data: Record<string, unknown>,
): Promise<void> {
  const messages = (data.messages as MessageData[]) ?? [data as unknown as MessageData];

  for (const msg of messages) {
    const { key, messageTimestamp, pushName, message } = msg;
    const { remoteJid, fromMe, id: messageId } = key;

    // Evolution nem sempre envia messageType — derivar das chaves do objeto message
    const messageType: string = msg.messageType ?? deriveMessageType(message);

    const isGroup = remoteJid.endsWith("@g.us");
    const participantJid = (key as Record<string, unknown>).participant as string | undefined;
    const senderJid = isGroup && participantJid ? participantJid : remoteJid;

    // Upsert contato do grupo (para o chat)
    const { data: groupContact } = await supabase
      .from("contacts")
      .upsert({
        tenant_id: tenantId,
        jid: remoteJid,
        push_name: isGroup ? null : (pushName ?? null),
        is_group: isGroup,
      }, { onConflict: "tenant_id,jid" })
      .select("id")
      .single();

    // Upsert contato do remetente (participante em grupos, ou o próprio contato em DMs)
    const { data: senderContact } = await supabase
      .from("contacts")
      .upsert({
        tenant_id: tenantId,
        jid: senderJid,
        push_name: pushName ?? null,
        is_group: false,
      }, { onConflict: "tenant_id,jid" })
      .select("id")
      .single();

    // Upsert chat — dois passos para preservar nomes de grupo
    // Passo 1: INSERT apenas se não existir (ignoreDuplicates protege o nome real do grupo)
    // Para grupos: pushName é o nome do REMETENTE, não do grupo — nunca usar como nome do chat
    const { data: existingChat } = await supabase
      .from("chats")
      .select("id, name")
      .eq("session_id", sessionId)
      .eq("jid", remoteJid)
      .single();

    await supabase
      .from("chats")
      .upsert(
        {
          tenant_id: tenantId,
          session_id: sessionId,
          contact_id: groupContact?.id ?? null,
          jid: remoteJid,
          name: isGroup ? remoteJid : (!fromMe && pushName ? pushName : remoteJid),
        },
        { onConflict: "session_id,jid", ignoreDuplicates: true },
      );

    // Extrair body do texto para preview
    const body = extractTextBody(message);
    const caption = extractCaption(message);
    const hasMedia = isMediaMessage(messageType);
    const previewBody = body ?? caption ?? (hasMedia ? `[${normalizeMessageType(messageType)}]` : null);

    // Passo 2: atualizar last_message_at (e pushName para DMs) sem tocar no nome do grupo
    const { data: chat } = await supabase
      .from("chats")
      .update({
        last_message_at: new Date(messageTimestamp * 1000).toISOString(),
        ...(previewBody ? { last_message_body: previewBody } : {}),
        ...(groupContact?.id ? { contact_id: groupContact.id } : {}),
        // Para DMs recebidas: atualizar nome com pushName do contato. Para enviadas: nunca sobrescrever com seu próprio nome.
        ...(!isGroup && !fromMe && pushName ? { name: pushName } : {}),
      })
      .eq("session_id", sessionId)
      .eq("jid", remoteJid)
      .select("id")
      .single();

    // Se é grupo novo (nome ainda é JID), buscar nome real da Evolution API
    const chatNameIsJid = !existingChat || existingChat.name === remoteJid;
    if (isGroup && chatNameIsJid && chat?.id) {
      fetchGroupSubject(instance, remoteJid, chat.id);
    }

    // Extrair ID da mensagem-alvo para reações
    const reactionMsg = message.reactionMessage as Record<string, unknown> | undefined;
    const reactionTo = reactionMsg
      ? ((reactionMsg.key as Record<string, unknown>)?.id as string | undefined) ?? null
      : null;

    // Upsert message — contact_id aponta para o REMETENTE (participante em grupos)
    const { data: savedMessage } = await supabase
      .from("messages")
      .upsert({
        tenant_id: tenantId,
        session_id: sessionId,
        chat_id: chat?.id ?? null,
        contact_id: senderContact?.id ?? null,
        message_id: messageId,
        from_me: fromMe,
        type: normalizeMessageType(messageType),
        body,
        caption,
        is_forwarded: isForwarded(message),
        duration_secs: extractDuration(message),
        timestamp: new Date(messageTimestamp * 1000).toISOString(),
        reaction_to: reactionTo,
        raw_payload: data,
      }, { onConflict: "session_id,message_id" })
      .select("id")
      .single();

    // Para mensagens de texto com body: acionar geração de embedding de forma assíncrona
    if (savedMessage?.id && body && body.trim().length > 0 && normalizeMessageType(messageType) === "text") {
      triggerEmbeddingGeneration({
        messageId: savedMessage.id,
        body,
        tenantId,
        messageType: normalizeMessageType(messageType),
      });
    }

    // Fire-and-forget webhook delivery
    if (savedMessage?.id) {
      fetch(`${SUPABASE_URL}/functions/v1/webhook-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          tenantId,
          event: "message.received",
          payload: { messageId: savedMessage.id, chatId: chat?.id ?? null, fromMe, type: normalizeMessageType(messageType), body },
        }),
      }).catch(() => {});
    }

    // Verificar alertas para mensagens de texto com body
    if (savedMessage?.id && body && body.trim().length > 0) {
      checkAlerts(tenantId, sessionId, savedMessage.id, body);
    }

    // Se tem mídia: criar media_file e acionar download de forma assíncrona
    if (hasMedia && savedMessage?.id) {
      const downloadUrl = extractDownloadUrl(message);
      const mimeType = extractMimeType(message) ?? "application/octet-stream";

      const { error: mediaError } = await supabase.from("media_files").insert({
        tenant_id: tenantId,
        message_id: savedMessage.id,
        mime_type: mimeType,
        download_status: "pending",
      });

      if (mediaError) {
        await logEvent(tenantId, sessionId, "error", { messageId: savedMessage.id }, `media_files insert: ${mediaError.message}`);
      } else {
        triggerMediaDownloader({
          messageId: savedMessage.id,
          tenantId,
          sessionId,
          downloadUrl: downloadUrl ?? "",
          mimeType,
          evolutionMessageId: messageId,
          instanceName: instance,
          evolutionKey: key as Record<string, unknown>,
          evolutionMessage: message,
        });
      }
    }
  }
}

// ─── messages.update ─────────────────────────────────────────────────────────

async function handleMessagesUpdate(
  tenantId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const updates = Array.isArray(data) ? data : [data];

  for (const item of updates) {
    const key = item.key as Record<string, unknown> | undefined;
    const update = item.update as Record<string, unknown> | undefined;
    if (!key?.id || !update) continue;

    const messageId = key.id as string;

    // ACK de status de entrega
    if (update.status) {
      const statusMap: Record<string, string> = {
        ERROR: "error", PENDING: "pending", SERVER_ACK: "sent",
        DELIVERY_ACK: "delivered", READ: "read", PLAYED: "played",
      };
      const deliveryStatus = statusMap[update.status as string] ?? String(update.status).toLowerCase();
      await supabase
        .from("messages")
        .update({ delivery_status: deliveryStatus } as Record<string, unknown>)
        .eq("session_id", sessionId)
        .eq("message_id", messageId);
    }

    // Deleção via protocolMessage REVOKE
    const proto = (update.message as Record<string, unknown>)?.protocolMessage as Record<string, unknown> | undefined;
    if (proto?.type === "REVOKE") {
      const targetId = (proto.key as Record<string, unknown>)?.id as string ?? messageId;
      await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString(), body: null } as Record<string, unknown>)
        .eq("session_id", sessionId)
        .eq("message_id", targetId);
    }

    // Edição de mensagem
    const edited = (update.editedMessage as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    if (edited) {
      const newBody = extractTextBody(edited);
      if (newBody) {
        await supabase
          .from("messages")
          .update({ body: newBody, edited_at: new Date().toISOString() } as Record<string, unknown>)
          .eq("session_id", sessionId)
          .eq("message_id", messageId);
      }
    }
  }
}

// ─── messages.delete ─────────────────────────────────────────────────────────

async function handleMessagesDelete(
  tenantId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const key = data.key as Record<string, unknown> | undefined;
  if (!key?.id) return;

  await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), body: null } as Record<string, unknown>)
    .eq("session_id", sessionId)
    .eq("message_id", key.id as string);
}

// ─── connection.update ────────────────────────────────────────────────────────

async function handleConnectionUpdate(
  tenantId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const state = data.state as string | undefined;
  if (!state) return;

  const statusMap: Record<string, string> = {
    open: "connected",
    close: "disconnected",
    connecting: "connecting",
  };

  const status = statusMap[state] ?? "disconnected";

  await supabase
    .from("wa_sessions")
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);

  await logEvent(tenantId, sessionId, "session_status_changed", { state, status });
}

// ─── qrcode.updated ──────────────────────────────────────────────────────────

async function handleQrcodeUpdated(
  tenantId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const qrCode = (data.qrcode as Record<string, unknown>)?.base64 as string | undefined;
  if (!qrCode) return;

  await supabase
    .from("wa_sessions")
    .update({ qr_code: qrCode, status: "connecting" })
    .eq("id", sessionId);

  await logEvent(tenantId, sessionId, "qrcode_updated", null);
}

// ─── Trigger assíncrono do generate-embeddings ───────────────────────────────

interface EmbeddingTriggerPayload {
  messageId: string;
  body: string;
  tenantId: string;
  messageType: string;
}

function triggerEmbeddingGeneration(payload: EmbeddingTriggerPayload): void {
  // Fire-and-forget — não aguardar
  fetch(`${SUPABASE_URL}/functions/v1/generate-embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to trigger generate-embeddings:", err));
}

// ─── Trigger assíncrono do media-downloader ───────────────────────────────────

interface MediaTriggerPayload {
  messageId: string;
  tenantId: string;
  sessionId: string;
  downloadUrl: string;
  mimeType: string;
  evolutionMessageId: string;
  instanceName: string;
  // Objeto completo necessário para getBase64FromMediaMessage descriptografar
  evolutionKey?: Record<string, unknown>;
  evolutionMessage?: Record<string, unknown>;
}

function triggerMediaDownloader(payload: MediaTriggerPayload): void {
  // Fire-and-forget — não aguardar
  fetch(`${SUPABASE_URL}/functions/v1/media-downloader`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to trigger media-downloader:", err));
}

// ─── Helpers de parsing do payload Evolution ─────────────────────────────────

function deriveMessageType(message: Record<string, unknown>): string {
  const mediaKeys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "reactionMessage", "extendedTextMessage"];
  for (const key of mediaKeys) {
    if (message[key]) return key;
  }
  if (message.conversation) return "conversation";
  return "unknown";
}

function extractTextBody(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  return (
    (message.conversation as string) ??
    ((message.extendedTextMessage as Record<string, unknown>)?.text as string) ??
    // Reação: emoji em reactionMessage.text
    ((message.reactionMessage as Record<string, unknown>)?.text as string) ??
    // Localização: endereço formatado
    ((message.locationMessage as Record<string, unknown>)?.name as string) ??
    // Contato: nome do contato
    ((message.contactMessage as Record<string, unknown>)?.displayName as string) ??
    null
  );
}

function extractCaption(message: Record<string, unknown>): string | null {
  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const m = message[key] as Record<string, unknown> | undefined;
    if (m?.caption) return m.caption as string;
  }
  return null;
}

function extractDownloadUrl(message: Record<string, unknown>): string | null {
  const mediaKeys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
  for (const key of mediaKeys) {
    const m = message[key] as Record<string, unknown> | undefined;
    if (m?.url) return m.url as string;
    if (m?.directPath) return m.directPath as string;
  }
  return null;
}

function extractMimeType(message: Record<string, unknown>): string | null {
  const mediaKeys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
  for (const key of mediaKeys) {
    const m = message[key] as Record<string, unknown> | undefined;
    if (m?.mimetype) return m.mimetype as string;
  }
  return null;
}

function extractDuration(message: Record<string, unknown>): number | null {
  const m = (message.audioMessage ?? message.videoMessage) as Record<string, unknown> | undefined;
  return (m?.seconds as number) ?? null;
}

function isMediaMessage(type: string): boolean {
  return ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type);
}

function isForwarded(message: Record<string, unknown>): boolean {
  for (const key of Object.keys(message)) {
    const m = message[key] as Record<string, unknown> | undefined;
    if (m?.contextInfo?.isForwarded) return true;
  }
  return false;
}

function normalizeMessageType(type: string): string {
  const map: Record<string, string> = {
    conversation: "text",
    extendedTextMessage: "text",
    imageMessage: "image",
    audioMessage: "audio",
    videoMessage: "video",
    documentMessage: "document",
    stickerMessage: "sticker",
    reactionMessage: "reaction",
    contactMessage: "contact",
    contactsArrayMessage: "contact",
    interactiveMessage: "interactive",
    interactiveResponseMessage: "interactive",
    pollCreationMessage: "poll",
    pollUpdateMessage: "poll",
    viewOnceMessage: "image",
    viewOnceMessageV2: "image",
    locationMessage: "location",
    liveLocationMessage: "location",
    // Mensagens de sistema — sem conteúdo visível
    protocolMessage: "system",
    senderKeyDistributionMessage: "system",
    messageContextInfo: "system",
    encReactionMessage: "reaction",
  };
  return map[type] ?? "unknown";
}

// ─── Busca nome real do grupo via Evolution API ───────────────────────────────

function fetchGroupSubject(instanceName: string, groupJid: string, chatId: string): void {
  (async () => {
    try {
      const res = await fetch(
        `${Deno.env.get("EVOLUTION_API_URL")}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
        { headers: { "apikey": Deno.env.get("EVOLUTION_API_KEY")! } },
      );
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>;
      // Evolution pode retornar array ou objeto direto
      const info = Array.isArray(data) ? data[0] : data;
      const subject = (info?.subject ?? info?.name) as string | undefined;
      if (subject && subject.trim()) {
        await supabase.from("chats").update({ name: subject.trim() }).eq("id", chatId);
      }
    } catch { /* fire-and-forget */ }
  })();
}

// ─── Verificação de alertas ───────────────────────────────────────────────────

interface AlertRow {
  id: string;
  keywords: string[];
  session_id: string | null;
}

function checkAlerts(
  tenantId: string,
  sessionId: string,
  messageId: string,
  body: string,
): void {
  // Fire-and-forget
  (async () => {
    const { data: alerts } = await supabase
      .from("alerts")
      .select("id, keywords, session_id")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    if (!alerts || alerts.length === 0) return;

    const lowerBody = body.toLowerCase();

    for (const alert of alerts as AlertRow[]) {
      // If alert scoped to a specific session, skip other sessions
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
          break; // one event per alert per message
        }
      }
    }
  })().catch((err) => console.error("checkAlerts error:", err));
}

// ─── Log de eventos ───────────────────────────────────────────────────────────

async function logEvent(
  tenantId: string | null,
  sessionId: string | null,
  eventType: string,
  payload: unknown,
  error?: string,
): Promise<void> {
  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    event_type: eventType,
    payload,
    error: error ?? null,
  });
}
