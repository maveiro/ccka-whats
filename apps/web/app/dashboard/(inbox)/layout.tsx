import { createClient } from "@/lib/supabase/server";
import ChatList from "@/components/chat-list";

// Layout compartilhado por /dashboard e /dashboard/chat/[id] (route group, não
// aparece na URL) — mantém o ChatList (e o estado de qual número está
// selecionado) montado ao navegar entre as duas rotas. Antes cada page.tsx
// renderizava seu próprio <ChatList>, então clicar numa conversa remontava o
// componente do zero e perdia a seleção do número.
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  const { data: rawChats, error: chatsError } = await supabase
    .from("chats")
    .select(`
      id,
      jid,
      name,
      avatar_url,
      last_message_at,
      last_message_body,
      unread_count,
      session_id,
      wa_sessions ( label, phone_number, status )
    `)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (chatsError) console.error("InboxLayout: failed to load chats:", chatsError.message);

  const chats = (rawChats ?? []).map((c) => ({
    ...c,
    wa_sessions: Array.isArray(c.wa_sessions) ? c.wa_sessions[0] ?? null : c.wa_sessions,
  }));

  return (
    <div className="flex h-full">
      <ChatList chats={chats} operatorRole={operator?.role ?? "operator"} />
      {children}
    </div>
  );
}
