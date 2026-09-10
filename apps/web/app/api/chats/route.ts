import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Conversas de UM número. Existe porque a caixa de entrada carrega só as 50
// conversas mais recentes do tenant inteiro: um número movimentado ocupa todas
// as vagas e os outros somem da tela — inclusive do filtro, que era derivado
// dessas 50 (achado em 09/09/2026, com 4.628 chats num número e 3 em outro).
//
// RLS decide o que aparece: `has_session_access` já limita o operator aos
// números que ele pode ver (regra 20), então não há filtro de app aqui.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId é obrigatório" }, { status: 400 });

  const { data, error } = await supabase
    .from("chats")
    .select(`
      id, jid, name, avatar_url, last_message_at, last_message_body,
      unread_count, session_id,
      wa_sessions ( label, phone_number, status )
    `)
    .eq("session_id", sessionId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const chats = (data ?? []).map((c) => ({
    ...c,
    wa_sessions: Array.isArray(c.wa_sessions) ? c.wa_sessions[0] ?? null : c.wa_sessions,
  }));

  return NextResponse.json(chats);
}
