import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30"), 100);

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Busca FTS em mensagens via search_vector (gerado com to_tsvector portuguese)
  const { data: messages, error } = await supabase
    .from("messages")
    .select(`
      id, type, body, caption, from_me, timestamp, chat_id,
      chats ( id, name, jid ),
      contacts ( push_name, name )
    `)
    .textSearch("search_vector", q, { type: "websearch", config: "portuguese" })
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Busca por chats pelo nome (ilike — sem generated column em chats)
  const { data: chats } = await supabase
    .from("chats")
    .select("id, name, jid, last_message_at, unread_count")
    .ilike("name", `%${q}%`)
    .limit(10);

  return NextResponse.json({
    messages: (messages ?? []).map((m) => ({
      ...m,
      chats: Array.isArray(m.chats) ? m.chats[0] ?? null : m.chats,
      contacts: Array.isArray(m.contacts) ? m.contacts[0] ?? null : m.contacts,
    })),
    chats: chats ?? [],
  });
}
