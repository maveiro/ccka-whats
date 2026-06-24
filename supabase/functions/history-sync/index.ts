import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;
const MESSAGES_PER_PAGE = 50;

interface SyncRequest {
  sessionId: string;   // UUID da wa_session
  remoteJid?: string;  // se omitido, sincroniza todos os chats
  limit?: number;      // máximo de mensagens por chat (default: 200)
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: SyncRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { sessionId, remoteJid, limit = 200 } = body;

  if (!sessionId) {
    return new Response("sessionId is required", { status: 400 });
  }

  // Buscar a sessão
  const { data: session } = await supabase
    .from("wa_sessions")
    .select("id, tenant_id, evolution_instance_name")
    .eq("id", sessionId)
    .single();

  if (!session?.evolution_instance_name) {
    return new Response("Session not found or missing instance name", { status: 404 });
  }

  const { tenant_id: tenantId, evolution_instance_name: instanceName } = session;

  // Buscar lista de chats do Evolution
  interface EvolutionChat { remoteJid: string; pushName?: string; name?: string }
  let chatsToSync: EvolutionChat[] = [];

  if (remoteJid) {
    chatsToSync = [{ remoteJid }];
  } else {
    const chatsRes = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_KEY },
      body: JSON.stringify({}),
    });

    if (!chatsRes.ok) {
      await logEvent(tenantId, sessionId, "error", null, `findChats failed: ${chatsRes.status}`);
      return new Response("Failed to fetch chats", { status: 500 });
    }

    chatsToSync = await chatsRes.json() as EvolutionChat[];
  }

  await logEvent(tenantId, sessionId, "webhook_received", {
    type: "history_sync_started",
    chats: chatsToSync.length,
  });

  // Sincronizar cada chat
  let totalImported = 0;
  for (const chat of chatsToSync) {
    try {
      const isGroupJid = chat.remoteJid.endsWith("@g.us");
      // Para grupos: NUNCA usar pushName (é o nome do último remetente, não do grupo).
      // Se não tiver name real do grupo, usa null — o upsert preserva o nome já existente.
      const chatName = isGroupJid
        ? (chat.name ?? null)
        : (chat.pushName ?? chat.name ?? null);
      const count = await syncChat(
        tenantId, sessionId, instanceName,
        chat.remoteJid,
        chatName,
        limit,
      );
      totalImported += count;
    } catch (err) {
      await logEvent(tenantId, sessionId, "error", { jid: chat.remoteJid }, String(err));
    }
  }

  await logEvent(tenantId, sessionId, "webhook_received", {
    type: "history_sync_completed",
    totalImported,
    chats: chatsToSync.length,
  });

  return new Response(JSON.stringify({ totalImported, chats: chatsToSync.length }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function syncChat(
  tenantId: string,
  sessionId: string,
  instanceName: string,
  remoteJid: string,
  chatName: string | null,
  maxMessages: number,
): Promise<number> {
  const isGroup = remoteJid.endsWith("@g.us");
  let page = 1;
  let imported = 0;

  while (imported < maxMessages) {
    const res = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_KEY },
      body: JSON.stringify({
        where: { key: { remoteJid } },
        limit: MESSAGES_PER_PAGE,
        page,
      }),
    });

    if (!res.ok) break;

    const data = await res.json() as {
      messages: { total: number; pages: number; currentPage: number; records: EvolutionMessage[] };
    };

    const { records, pages } = data.messages;
    if (!records?.length) break;

    // Upsert contato do chat (grupo ou pessoa)
    const chatContact = await upsertContact(tenantId, remoteJid, null, isGroup);

    // Upsert chat — dois passos para não sobrescrever nome real de grupo com pushName errado.
    // Passo 1: INSERT se não existir (preserva nome já gravado)
    await supabase
      .from("chats")
      .upsert(
        {
          tenant_id: tenantId,
          session_id: sessionId,
          contact_id: chatContact?.id ?? null,
          jid: remoteJid,
          name: chatName ?? remoteJid,
        },
        { onConflict: "session_id,jid", ignoreDuplicates: true },
      );

    // Passo 2: atualizar contact_id e, para DMs com nome real, o nome
    const { data: chat } = await supabase
      .from("chats")
      .update({
        contact_id: chatContact?.id ?? null,
        ...(!isGroup && chatName ? { name: chatName } : {}),
      })
      .eq("session_id", sessionId)
      .eq("jid", remoteJid)
      .select("id")
      .single();

    for (const msg of records) {
      const { key, messageType, messageTimestamp, pushName, message } = msg;
      const participantJid = key.participant ?? null;
      const senderJid = isGroup && participantJid ? participantJid : remoteJid;

      const senderContact = await upsertContact(tenantId, senderJid, pushName ?? null, false);

      const body = extractTextBody(message);
      const type = normalizeMessageType(messageType ?? deriveMessageType(message));

      const { data: savedMsg } = await supabase.from("messages").upsert({
        tenant_id: tenantId,
        session_id: sessionId,
        chat_id: chat?.id ?? null,
        contact_id: senderContact?.id ?? null,
        message_id: key.id,
        from_me: key.fromMe,
        type,
        body,
        caption: extractCaption(message),
        is_forwarded: false,
        timestamp: new Date(messageTimestamp * 1000).toISOString(),
        raw_payload: msg,
      }, { onConflict: "session_id,message_id" }).select("id").single();

      // Disparar download de mídia para mensagens de imagem/áudio/vídeo/documento
      if (savedMsg?.id && ["image", "audio", "video", "document"].includes(type)) {
        const mimeType = extractMimeType(message, type);
        if (mimeType) {
          // Criar registro em media_files se não existir
          const { data: existing } = await supabase
            .from("media_files")
            .select("id")
            .eq("message_id", savedMsg.id)
            .single();

          if (!existing) {
            await supabase.from("media_files").insert({
              tenant_id: tenantId,
              message_id: savedMsg.id,
              mime_type: mimeType,
              download_status: "pending",
              download_attempts: 0,
            });
          }

          // Disparar media-downloader fire-and-forget
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          fetch(`${supabaseUrl}/functions/v1/media-downloader`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              messageId: savedMsg.id,
              tenantId,
              sessionId,
              downloadUrl: "",
              mimeType,
              evolutionMessageId: key.id,
              instanceName,
              evolutionKey: key,
              evolutionMessage: message,
            }),
          }).catch(() => {});
        }
      }

      imported++;
    }

    if (page >= pages) break;
    page++;
  }

  return imported;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface EvolutionMessage {
  key: { id: string; fromMe: boolean; remoteJid: string; participant?: string };
  pushName?: string;
  messageType?: string;
  message: Record<string, unknown>;
  messageTimestamp: number;
}

async function upsertContact(
  tenantId: string,
  jid: string,
  pushName: string | null,
  isGroup: boolean,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("contacts")
    .upsert({
      tenant_id: tenantId,
      jid,
      push_name: pushName,
      is_group: isGroup,
    }, { onConflict: "tenant_id,jid" })
    .select("id")
    .single();
  return data;
}

function extractTextBody(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  return (
    (message.conversation as string) ??
    ((message.extendedTextMessage as Record<string, unknown>)?.text as string) ??
    ((message.reactionMessage as Record<string, unknown>)?.text as string) ??
    ((message.locationMessage as Record<string, unknown>)?.name as string) ??
    ((message.contactMessage as Record<string, unknown>)?.displayName as string) ??
    null
  );
}

function extractCaption(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const m = message[key] as Record<string, unknown> | undefined;
    if (m?.caption) return m.caption as string;
  }
  return null;
}

function extractMimeType(message: Record<string, unknown> | null, type: string): string | null {
  if (!message) return null;
  const typeKeyMap: Record<string, string> = {
    image: "imageMessage",
    audio: "audioMessage",
    video: "videoMessage",
    document: "documentMessage",
  };
  const key = typeKeyMap[type];
  if (!key) return null;
  const m = message[key] as Record<string, unknown> | undefined;
  return (m?.mimetype as string) ?? null;
}

function deriveMessageType(message: Record<string, unknown> | null): string {
  if (!message) return "unknown";
  const keys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "reactionMessage", "extendedTextMessage"];
  for (const key of keys) {
    if (message[key]) return key;
  }
  if (message.conversation) return "conversation";
  return "unknown";
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
    protocolMessage: "system",
    senderKeyDistributionMessage: "system",
    messageContextInfo: "system",
    encReactionMessage: "reaction",
  };
  return map[type] ?? "unknown";
}

async function logEvent(
  tenantId: string,
  sessionId: string,
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
