import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
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
    .select("jid, session_id, wa_sessions ( evolution_instance_name )")
    .eq("id", chatId)
    .single();

  if (!chat) return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });

  const sessions = Array.isArray(chat.wa_sessions) ? chat.wa_sessions[0] : chat.wa_sessions;
  const instanceName = (sessions as { evolution_instance_name: string | null } | null)?.evolution_instance_name;

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
    const errText = await evoRes.text();
    return NextResponse.json({ error: `Evolution error: ${errText}` }, { status: 502 });
  }

  const result = await evoRes.json();
  return NextResponse.json({ ok: true, result });
}
