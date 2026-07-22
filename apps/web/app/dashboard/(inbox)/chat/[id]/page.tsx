import { notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import ChatView from "@/components/chat-view";

interface Props {
  params: Promise<{ id: string }>;
}

const INITIAL_LIMIT = 50;

export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: chat } = await supabase
    .from("chats")
    .select("id, name, jid, session_id")
    .eq("id", id)
    .single();

  if (!chat) notFound();

  const { data: rawMessages } = await supabase
    .from("messages")
    .select(`
      id, message_id, type, body, caption, from_me, timestamp,
      deleted_at, edited_at, delivery_status, reaction_to,
      media_files ( storage_path, mime_type, download_status ),
      contacts ( push_name, name )
    `)
    .eq("chat_id", id)
    .order("timestamp", { ascending: false })
    .limit(INITIAL_LIMIT);

  // Ordenar cronologicamente
  const sortedRaw = (rawMessages ?? []).reverse();

  // Gerar URLs assinadas para mídias (bucket privado).
  // Assinar com admin client: o usuário já passou pela RLS de `messages` ao
  // buscar acima; o client autenticado não tem policy de storage p/ assinar.
  const storage = createAdminClient();
  const messages = await Promise.all(
    sortedRaw.map(async (msg) => {
      const media = Array.isArray(msg.media_files) ? msg.media_files[0] ?? null : msg.media_files;
      const contacts = Array.isArray(msg.contacts) ? msg.contacts[0] ?? null : msg.contacts;
      if (media?.storage_path && media.download_status === "done") {
        const { data: signed } = await storage.storage
          .from("media")
          .createSignedUrl(media.storage_path, 3600);
        return { ...msg, media_files: media ? [media] : null, contacts, signedUrl: signed?.signedUrl ?? null };
      }
      return { ...msg, media_files: media ? [media] : null, contacts, signedUrl: null };
    })
  );

  const isGroup = chat.jid.endsWith("@g.us");
  // hasMore = true se retornou exatamente o limite (pode ter mais)
  const hasMore = (rawMessages?.length ?? 0) === INITIAL_LIMIT;

  return (
    <ChatView
      chat={chat}
      messages={messages}
      isGroup={isGroup}
      hasMore={hasMore}
    />
  );
}
