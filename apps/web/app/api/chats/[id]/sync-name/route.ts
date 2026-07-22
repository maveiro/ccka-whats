import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: chat } = await admin
    .from("chats")
    .select("id, jid, session_id, tenant_id, wa_sessions ( evolution_instance_name )")
    .eq("id", id)
    .single();

  if (!chat) return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });

  const sessions = Array.isArray(chat.wa_sessions) ? chat.wa_sessions[0] : chat.wa_sessions;
  const instanceName = (sessions as { evolution_instance_name: string | null } | null)?.evolution_instance_name;
  if (!instanceName) return NextResponse.json({ error: "Sem instância Evolution" }, { status: 400 });

  const jid: string = chat.jid;
  let resolvedName: string | null = null;
  let avatarUrl: string | null = null;

  // Nome + avatar de contatos (@s.whatsapp.net e @lid) e avatar de grupos vêm todos
  // do mesmo endpoint bulk `/chat/findContacts` (POST), casados por `remoteJid`.
  // `/contact/fetchContacts` (GET) usado antes aqui não existe nesta versão do
  // Evolution API — sempre retornava 404 e o nome nunca era resolvido.
  try {
    const res = await fetch(
      `${env.EVOLUTION_API_URL}/chat/findContacts/${instanceName}`,
      {
        method: "POST",
        headers: { apikey: env.EVOLUTION_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      const contacts = await res.json() as Array<Record<string, unknown>>;
      if (Array.isArray(contacts)) {
        const match = contacts.find((c) => c.remoteJid === jid);
        const pushName = match?.pushName as string | undefined;
        if (!jid.endsWith("@g.us") && pushName?.trim()) resolvedName = pushName.trim();
        if (match?.profilePicUrl) avatarUrl = match.profilePicUrl as string;
      }
    }
  } catch { /* ignore */ }

  if (jid.endsWith("@g.us")) {
    // Grupo: nome vem do subject (mais confiável e atualizado que o findContacts)
    try {
      const res = await fetch(
        `${env.EVOLUTION_API_URL}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(jid)}`,
        { headers: { apikey: env.EVOLUTION_API_KEY } },
      );
      if (res.ok) {
        const data = await res.json() as Record<string, unknown> | Array<Record<string, unknown>>;
        const info = Array.isArray(data) ? data[0] : data;
        const subject = (info?.subject ?? info?.name) as string | undefined;
        if (subject?.trim()) resolvedName = subject.trim();
      }
    } catch { /* ignore */ }
  }

  if (!resolvedName && !avatarUrl) {
    return NextResponse.json({ ok: false, message: "Nada encontrado no Evolution" });
  }

  const update: Record<string, string> = {};
  if (resolvedName) update.name = resolvedName;
  if (avatarUrl) update.avatar_url = avatarUrl;

  const { error } = await admin.from("chats").update(update).eq("id", id);
  if (error) {
    await admin.from("events_log").insert({
      tenant_id: chat.tenant_id,
      session_id: chat.session_id,
      event_type: "error",
      payload: { chat_id: id, jid },
      error: `sync-name update failed: ${error.message}`,
    });
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name: resolvedName, avatarUrl });
}
