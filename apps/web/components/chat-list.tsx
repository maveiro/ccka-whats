"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDistanceToNow } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import SearchBar from "@/components/search-bar";

interface Chat {
  id: string;
  jid: string;
  name: string | null;
  last_message_at: string | null;
  unread_count: number;
  session_id: string;
  wa_sessions: { label: string | null; phone_number: string } | null;
}

interface ChatListProps {
  chats: Chat[];
  operatorRole: string;
}

export default function ChatList({ chats: initial, operatorRole }: ChatListProps) {
  const pathname = usePathname();
  const [chats, setChats] = useState(initial);

  // Sincroniza quando o servidor re-renderiza (navegação entre páginas)
  useEffect(() => {
    setChats(initial);
  }, [initial]);

  // Realtime: atualizar unread_count e last_message_at ao receber eventos
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("chat-list-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chats" },
        (payload) => {
          setChats((prev) =>
            prev.map((c) =>
              c.id === payload.new.id
                ? { ...c, unread_count: payload.new.unread_count, last_message_at: payload.new.last_message_at }
                : c,
            ).sort((a, b) => {
              const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return tb - ta;
            }),
          );
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (chats.length === 0) {
    return (
      <div className="w-72 border-r border-gray-800 flex items-center justify-center">
        <p className="text-gray-600 text-sm">Nenhuma conversa ainda</p>
      </div>
    );
  }

  return (
    <div className="w-72 border-r border-gray-800 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">Conversas</h2>
        <SearchBar />
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.map((chat) => {
          const active = pathname === `/dashboard/chat/${chat.id}`;
          return (
            <Link
              key={chat.id}
              href={`/dashboard/chat/${chat.id}`}
              className={`block px-4 py-3 border-b border-gray-900 hover:bg-gray-900 transition-colors ${
                active ? "bg-gray-900" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {chat.name ?? chat.jid}
                  </p>
                  {operatorRole === "admin" && chat.wa_sessions && (
                    <p className="text-xs text-gray-500 truncate">
                      {chat.wa_sessions.label ?? chat.wa_sessions.phone_number}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end shrink-0">
                  {chat.last_message_at && (
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(chat.last_message_at)}
                    </span>
                  )}
                  {chat.unread_count > 0 && (
                    <span className="mt-1 text-xs bg-green-600 text-white rounded-full px-1.5 py-0.5">
                      {chat.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
