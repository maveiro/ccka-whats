import { createClient } from "@/lib/supabase/server";
import ChatList from "@/components/chat-list";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, id")
    .eq("id", user!.id)
    .single();

  // Admin vê todos os chats, operator vê apenas os do seu session
  const query = supabase
    .from("chats")
    .select(`
      id,
      jid,
      name,
      last_message_at,
      unread_count,
      session_id,
      wa_sessions ( label, phone_number )
    `)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawChats } = await query;
  const chats = (rawChats ?? []).map((c) => ({
    ...c,
    wa_sessions: Array.isArray(c.wa_sessions) ? c.wa_sessions[0] ?? null : c.wa_sessions,
  }));

  return (
    <div className="flex h-full">
      <ChatList chats={chats} operatorRole={operator?.role ?? "operator"} />
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Selecione uma conversa
      </div>
    </div>
  );
}
