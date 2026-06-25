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
    .select("id, jid, session_id, wa_sessions ( evolution_instance_name )")
    .eq("id", id)
    .single();

  if (!chat) return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });

  const sessions = Array.isArray(chat.wa_sessions) ? chat.wa_sessions[0] : chat.wa_sessions;
  const instanceName = (sessions as { evolution_instance_name: string | null } | null)?.evolution_instance_name;
  if (!instanceName) return NextResponse.json({ error: "Sem instância Evolution" }, { status: 400 });

  const jid: string = chat.jid;
  let resolvedName: string | null = null;

  if (jid.endsWith("@g.us")) {
    // Grupo: buscar pelo endpoint de grupos
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
  } else {
    // Contato (@s.whatsapp.net ou @lid): buscar via fetchContacts
    try {
      const res = await fetch(
        `${env.EVOLUTION_API_URL}/contact/fetchContacts/${instanceName}`,
        { headers: { apikey: env.EVOLUTION_API_KEY } },
      );
      if (res.ok) {
        const contacts = await res.json() as Array<Record<string, unknown>>;
        if (Array.isArray(contacts)) {
          const match = contacts.find((c) => c.id === jid || c.remoteJid === jid);
          const name = (match?.pushName ?? match?.name ?? match?.verifiedName) as string | undefined;
          if (name?.trim()) resolvedName = name.trim();
        }
      }
    } catch { /* ignore */ }
  }

  if (!resolvedName) {
    return NextResponse.json({ ok: false, message: "Nome não encontrado no Evolution" });
  }

  await admin.from("chats").update({ name: resolvedName }).eq("id", id);

  return NextResponse.json({ ok: true, name: resolvedName });
}
