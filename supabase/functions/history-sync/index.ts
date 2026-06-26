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
  const { data: session, error: sessionError } = await supabase
    .from("wa_sessions")
    .select("id, tenant_id, evolution_instance_name")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session?.evolution_instance_name) {
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

  // Sincronizar chats em lotes paralelos (evitar timeout de 150s)
  const CONCURRENCY = 5;
  let totalImported = 0;

  for (let i = 0; i < chatsToSync.length; i += CONCURRENCY) {
    const batch = chatsToSync.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((chat) => {
        const isGroupJid = chat.remoteJid.endsWith("@g.us");
        const chatName = isGroupJid
          ? (chat.name ?? null)
          : (chat.pushName ?? chat.name ?? null);
        return syncChat(tenantId, sessionId, instanceName, chat.remoteJid, chatName, limit);
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        totalImported += result.value;
      } else {
        await logEvent(tenantId, sessionId, "error", null, String(result.reason));
      }
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

  // ── Upsert chat uma vez, fora do loop de páginas ──────────────────────────
  const chatContact = await upsertContact(tenantId, remoteJid, null, isGroup);

  await supabase.from("chats").upsert(
    {
      tenant_id: tenantId,
      session_id: sessionId,
      contact_id: chatContact?.id ?? null,
      jid: remoteJid,
      name: chatName ?? remoteJid,
    },
    { onConflict: "session_id,jid", ignoreDuplicates: true },
  );

  const { data: chat } = await supabase
    .from("chats")
    .update({
      contact_id: chatContact?.id ?? null,
      ...(chatName ? { name: chatName } : {}),
    })
    .eq("session_id", sessionId)
    .eq("jid", remoteJid)
    .select("id, name")
    .single();

  if (isGroup && chat?.id && (!chat.name || chat.name === remoteJid)) {
    await fetchGroupSubjectAndUpdate(instanceName, remoteJid, chat.id);
  }

  // ── Paginar e importar mensagens ──────────────────────────────────────────
  let page = 1;
  let imported = 0;
  let lastMsgBody: string | null = null;
  let lastMsgTimestamp = 0;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  while (imported < maxMessages) {
    const res = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_KEY },
      body: JSON.stringify({ where: { key: { remoteJid } }, limit: MESSAGES_PER_PAGE, page }),
    });

    if (!res.ok) break;

    const data = await res.json() as {
      messages: { total: number; pages: number; currentPage: number; records: EvolutionMessage[] };
    };

    const { records, pages } = data.messages;
    if (!records?.length) break;

    // ── Upsert contatos únicos desta página em paralelo ───────────────────
    const senderNames = new Map<string, string | null>();
    for (const msg of records) {
      const senderJid = isGroup && msg.key.participant ? msg.key.participant : remoteJid;
      if (!senderNames.has(senderJid)) senderNames.set(senderJid, msg.pushName ?? null);
    }
    const contactResults = await Promise.allSettled(
      Array.from(senderNames.entries()).map(([jid, name]) =>
        upsertContact(tenantId, jid, name, false).then((c) => [jid, c?.id ?? null] as [string, string | null])
      ),
    );
    const contactMap = new Map<string, string | null>();
    for (const r of contactResults) {
      if (r.status === "fulfilled") contactMap.set(r.value[0], r.value[1]);
    }

    // ── Construir rows e índice de mídia ──────────────────────────────────
    type MsgRow = {
      tenant_id: string; session_id: string; chat_id: string | null;
      contact_id: string | null; message_id: string; from_me: boolean;
      type: string; body: string | null; caption: string | null;
      is_forwarded: boolean; timestamp: string; raw_payload: EvolutionMessage;
    };

    const msgRows: MsgRow[] = [];
    const mediaIndex = new Map<string, { key: EvolutionMessage["key"]; message: Record<string, unknown>; mimeType: string }>();

    for (const msg of records) {
      const { key, messageType, messageTimestamp, message } = msg;
      const senderJid = isGroup && key.participant ? key.participant : remoteJid;
      const body = extractTextBody(message);
      const type = normalizeMessageType(messageType ?? deriveMessageType(message));
      const caption = extractCaption(message);

      if (messageTimestamp > lastMsgTimestamp) {
        lastMsgTimestamp = messageTimestamp;
        lastMsgBody = body ?? caption ?? (["image","audio","video","document","sticker"].includes(type) ? `[${type}]` : null);
      }

      msgRows.push({
        tenant_id: tenantId,
        session_id: sessionId,
        chat_id: chat?.id ?? null,
        contact_id: contactMap.get(senderJid) ?? null,
        message_id: key.id,
        from_me: key.fromMe,
        type,
        body,
        caption,
        is_forwarded: false,
        timestamp: new Date(messageTimestamp * 1000).toISOString(),
        raw_payload: msg,
      });

      if (["image", "audio", "video", "document"].includes(type)) {
        const mimeType = extractMimeType(message, type);
        if (mimeType) mediaIndex.set(key.id, { key, message: message ?? {}, mimeType });
      }
    }

    // ── Bulk upsert de mensagens ──────────────────────────────────────────
    const { data: savedMessages, error: upsertError } = await supabase
      .from("messages")
      .upsert(msgRows, { onConflict: "session_id,message_id" })
      .select("id, message_id");

    if (upsertError) {
      await logEvent(tenantId, sessionId, "error", { remoteJid, page }, `messages.upsert: ${upsertError.message}`);
    }

    // ── Garantir media_files e acionar downloads ──────────────────────────
    if (savedMessages?.length && mediaIndex.size > 0) {
      const mediaDbIds = savedMessages
        .filter((s) => mediaIndex.has(s.message_id))
        .map((s) => s.id);

      const { data: existingMedia } = await supabase
        .from("media_files")
        .select("message_id, download_status")
        .in("message_id", mediaDbIds);

      const existingMap = new Map((existingMedia ?? []).map((m) => [m.message_id, m.download_status]));

      const newMediaRows = savedMessages
        .filter((s) => mediaIndex.has(s.message_id) && !existingMap.has(s.id))
        .map((s) => ({
          tenant_id: tenantId,
          message_id: s.id,
          mime_type: mediaIndex.get(s.message_id)!.mimeType,
          download_status: "pending",
          download_attempts: 0,
        }));

      if (newMediaRows.length > 0) {
        await supabase.from("media_files").insert(newMediaRows);
      }

      // Disparar downloads para mensagens sem download concluído
      for (const saved of savedMessages) {
        const evData = mediaIndex.get(saved.message_id);
        if (!evData) continue;
        if (existingMap.get(saved.id) === "done") continue;
        fetch(`${supabaseUrl}/functions/v1/media-downloader`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            messageId: saved.id,
            tenantId,
            sessionId,
            downloadUrl: "",
            mimeType: evData.mimeType,
            evolutionMessageId: evData.key.id,
            instanceName,
            evolutionKey: evData.key,
            evolutionMessage: evData.message,
          }),
        }).catch(() => {});
      }
    }

    imported += records.length;
    if (page >= pages) break;
    page++;
  }

  if (chat?.id && lastMsgBody) {
    await supabase.from("chats").update({ last_message_body: lastMsgBody }).eq("id", chat.id);
  }

  return imported;
}

async function fetchGroupSubjectAndUpdate(instanceName: string, groupJid: string, chatId: string): Promise<void> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      { headers: { "apikey": EVOLUTION_API_KEY } },
    );
    if (!res.ok) return;
    const data = await res.json() as Record<string, unknown>;
    const info = Array.isArray(data) ? data[0] : data;
    const subject = (info?.subject ?? info?.name) as string | undefined;
    if (subject && subject.trim()) {
      await supabase.from("chats").update({ name: subject.trim() }).eq("id", chatId);
    }
  } catch { /* best-effort */ }
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
