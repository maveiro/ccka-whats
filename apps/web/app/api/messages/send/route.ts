import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getCloudCredential } from "@/lib/whatsapp-cloud/getCloudCredential";
import { sendFreeformTextMessage, GraphApiError } from "@/lib/whatsapp-cloud/graphClient";

const CLOUD_API_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    return await handleSend(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = (err instanceof Error && err.cause) ? String(err.cause) : undefined;
    const detail = cause ? `${msg} — ${cause}` : msg;
    console.error("[messages/send] unhandled error:", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

async function handleSend(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    chatId: string;
    text?: string;
    mediaBase64?: string;
    mediaType?: string;   // "image" | "video" | "audio" | "document"
    mediaMime?: string;
    fileName?: string;
    caption?: string;
    quotedMessageId?: string;   // message_id do WhatsApp para quote
  };

  const { chatId, text, mediaBase64, mediaType, mediaMime, fileName, caption, quotedMessageId } = body;

  if (!chatId || (!text && !mediaBase64)) {
    return NextResponse.json({ error: "chatId + text ou mediaBase64 são obrigatórios" }, { status: 400 });
  }

  // Buscar chat + sessão
  const { data: chat } = await supabase
    .from("chats")
    .select("jid, session_id, tenant_id, wa_sessions ( evolution_instance_name, channel )")
    .eq("id", chatId)
    .single();

  if (!chat) return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });

  const sessions = Array.isArray(chat.wa_sessions) ? chat.wa_sessions[0] : chat.wa_sessions;
  const session = sessions as { evolution_instance_name: string | null; channel: string } | null;

  if (session?.channel === "cloud_api") {
    return sendViaCloudApi(supabase, {
      chatId,
      sessionId: chat.session_id,
      chatJid: chat.jid,
      tenantId: chat.tenant_id,
      text,
      mediaBase64,
    });
  }

  const instanceName = session?.evolution_instance_name;

  if (!instanceName) return NextResponse.json({ error: "Sessão sem instância Evolution" }, { status: 400 });

  const quotedPayload = quotedMessageId
    ? { key: { id: quotedMessageId, remoteJid: chat.jid } }
    : undefined;

  let evoRes: Response;

  if (mediaBase64) {
    // Enviar mídia
    evoRes = await fetch(`${env.EVOLUTION_API_URL}/message/sendMedia/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": env.EVOLUTION_API_KEY },
      body: JSON.stringify({
        number: chat.jid,
        mediatype: mediaType ?? "image",
        mimetype: mediaMime,
        media: mediaBase64,
        fileName: fileName ?? "arquivo",
        caption: caption ?? "",
        quoted: quotedPayload,
      }),
    });
  } else {
    // Enviar texto
    evoRes = await fetch(`${env.EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": env.EVOLUTION_API_KEY },
      body: JSON.stringify({
        number: chat.jid,
        text,
        quoted: quotedPayload,
      }),
    });
  }

  if (!evoRes.ok) {
    const errText = await evoRes.text().catch(() => `HTTP ${evoRes.status}`);
    return NextResponse.json({ error: `Evolution error: ${errText}` }, { status: 502 });
  }

  let result: unknown = null;
  const contentType = evoRes.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    result = await evoRes.json().catch(() => null);
  }
  return NextResponse.json({ ok: true, result });
}

// ─── WhatsApp Cloud API (módulo de campanhas) ─────────────────────────────
//
// Diferença importante do fluxo Evolution acima: lá, o envio ecoa de volta
// pelo whatsapp-webhook (Evolution) e é esse eco que persiste a mensagem
// enviada em `messages`. O webhook Cloud API só carrega `statuses`/
// `messages` inbound, nunca uma cópia do que a própria conta mandou — por
// isso este branch insere a linha em `messages` explicitamente.

async function sendViaCloudApi(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { chatId: string; sessionId: string; chatJid: string; tenantId: string; text?: string; mediaBase64?: string },
): Promise<NextResponse> {
  const { chatId, sessionId, chatJid, tenantId, text, mediaBase64 } = params;

  if (mediaBase64) {
    return NextResponse.json({ error: "Envio de mídia via WhatsApp Cloud API ainda não suportado" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text é obrigatório para envio via Cloud API" }, { status: 400 });
  }

  // Janela de 24h: Cloud API só permite texto livre dentro de 24h da
  // última mensagem inbound do contato — fora disso a Graph API rejeita
  // (erro 131047) e exige template. Checar antes evita um erro confuso
  // vindo direto do Meta.
  const { data: lastInbound } = await supabase
    .from("messages")
    .select("timestamp")
    .eq("chat_id", chatId)
    .eq("from_me", false)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  const withinWindow = lastInbound
    ? Date.now() - new Date(lastInbound.timestamp).getTime() < CLOUD_API_REPLY_WINDOW_MS
    : false;

  if (!withinWindow) {
    return NextResponse.json(
      { error: "Fora da janela de 24h desde a última mensagem do contato — use um template em Campanhas" },
      { status: 409 },
    );
  }

  const credential = await getCloudCredential(tenantId);
  if (!credential) {
    return NextResponse.json({ error: "Nenhuma credencial do WhatsApp Cloud API cadastrada" }, { status: 404 });
  }

  let wamid: string;
  try {
    const result = await sendFreeformTextMessage({
      phoneNumberId: credential.phone_number_id,
      accessToken: credential.access_token,
      to: chatJid,
      body: text,
    });
    wamid = result.wamid;
  } catch (err) {
    const message = err instanceof GraphApiError ? err.message : String(err);
    return NextResponse.json({ error: `Cloud API error: ${message}` }, { status: 502 });
  }

  const { error: insertError } = await supabase.from("messages").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    chat_id: chatId,
    message_id: wamid,
    from_me: true,
    type: "text",
    body: text,
    timestamp: new Date().toISOString(),
  });
  if (insertError) console.error("[messages/send] cloud_api messages insert failed:", insertError.message);

  return NextResponse.json({ ok: true, result: { wamid } });
}

