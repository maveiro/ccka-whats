import { createClient } from "@/lib/supabase/server";
import ChatList from "@/components/chat-list";
import { MessageSquare } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, id")
    .eq("id", user!.id)
    .single();

  const query = supabase
    .from("chats")
    .select(`
      id,
      jid,
      name,
      last_message_at,
      last_message_body,
      unread_count,
      session_id,
      wa_sessions ( label, phone_number, status )
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
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="w-14 h-14 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center">
          <MessageSquare size={26} className="text-gray-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-400">Selecione uma conversa</p>
          <p className="text-xs text-gray-600 mt-1 max-w-xs">
            Escolha um chat à esquerda para visualizar as mensagens e responder
          </p>
        </div>
      </div>
    </div>
  );
}
