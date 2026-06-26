import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// POST /api/admin/retry-media
// Reseta mídias com falha/pendente e dispara re-download via media-downloader.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("operators").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // 1. Resetar todas as mídias não concluídas
  await admin
    .from("media_files")
    .update({ download_status: "pending", download_attempts: 0 })
    .neq("download_status", "done");

  // 2. Buscar pendentes com dados da mensagem e sessão
  const { data: pending, error: fetchErr } = await admin
    .from("media_files")
    .select(`
      id,
      message_id,
      mime_type,
      messages (
        id,
        message_id,
        tenant_id,
        session_id,
        raw_payload,
        wa_sessions ( evolution_instance_name )
      )
    `)
    .eq("download_status", "pending")
    .limit(300);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  let triggered = 0;
  let skipped = 0;

  for (const mf of pending ?? []) {
    const msg = Array.isArray(mf.messages) ? mf.messages[0] : mf.messages;
    if (!msg) { skipped++; continue; }

    const session = Array.isArray(msg.wa_sessions) ? msg.wa_sessions[0] : msg.wa_sessions;
    const instanceName = (session as { evolution_instance_name: string | null } | null)?.evolution_instance_name;
    if (!instanceName) { skipped++; continue; }

    // Reconstruir dados do Evolution a partir do raw_payload
    const raw = msg.raw_payload as Record<string, unknown> | null;
    const msgs = Array.isArray(raw?.messages) ? raw!.messages as Record<string, unknown>[] : null;
    const first = msgs?.[0] ?? (raw as Record<string, unknown> | null);
    const evolutionKey = (first?.key as Record<string, unknown>) ?? undefined;
    const evolutionMessage = (first?.message as Record<string, unknown>) ?? undefined;
    const evolutionMessageId = (evolutionKey?.id as string) ?? msg.message_id;

    // Extrair URL de download direto (fallback)
    let downloadUrl = "";
    if (evolutionMessage) {
      for (const k of ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]) {
        const m = evolutionMessage[k] as Record<string, unknown> | undefined;
        if (m?.url) { downloadUrl = m.url as string; break; }
      }
    }

    fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/media-downloader`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messageId: mf.message_id,
        tenantId: msg.tenant_id,
        sessionId: msg.session_id,
        downloadUrl,
        mimeType: mf.mime_type ?? "application/octet-stream",
        evolutionMessageId,
        instanceName,
        evolutionKey,
        evolutionMessage,
      }),
    }).catch(() => undefined);

    triggered++;
  }

  return NextResponse.json({ ok: true, triggered, skipped });
}
