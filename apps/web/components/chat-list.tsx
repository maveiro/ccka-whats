"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDistanceToNow } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import SearchBar from "@/components/search-bar";
import { Users } from "lucide-react";

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

const AVATAR_COLORS = [
  "bg-violet-600",
  "bg-blue-600",
  "bg-teal-600",
  "bg-orange-500",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-amber-600",
];

function avatarColor(jid: string): string {
  let hash = 0;
  for (let i = 0; i < jid.length; i++) {
    hash = (hash * 31 + jid.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function ChatAvatar({ name, jid }: { name: string | null; jid: string }) {
  const isGroup = jid.endsWith("@g.us");
  const color = avatarColor(jid);

  if (isGroup) {
    return (
      <div
        className={`w-10 h-10 rounded-full ${color} flex items-center justify-center shrink-0`}
        aria-hidden="true"
      >
        <Users size={18} className="text-white opacity-90" />
      </div>
    );
  }

  const initial = (name ?? jid).charAt(0).toUpperCase();
  return (
    <div
      className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-sm font-bold text-white shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export default function ChatList({ chats: initial, operatorRole }: ChatListProps) {
  const pathname = usePathname();
  const [chats, setChats] = useState(initial);

  useEffect(() => {
    setChats(initial);
  }, [initial]);

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
      <div className="w-72 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800 space-y-2">
          <h2 className="text-sm font-medium text-gray-300">Conversas</h2>
          <SearchBar />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
            <Users size={22} className="text-gray-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-400">Nenhuma conversa ainda</p>
            <p className="text-xs text-gray-600 mt-1">As conversas do WhatsApp aparecem aqui em tempo real</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 border-r border-gray-800 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">Conversas</h2>
        <SearchBar />
      </div>
      <div className="flex-1 overflow-y-auto" role="list" aria-label="Lista de conversas">
        {chats.map((chat) => {
          const active = pathname === `/dashboard/chat/${chat.id}`;
          return (
            <Link
              key={chat.id}
              href={`/dashboard/chat/${chat.id}`}
              role="listitem"
              className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-900 hover:bg-gray-900 transition-colors min-h-[60px] ${
                active ? "bg-gray-900" : ""
              }`}
              aria-current={active ? "page" : undefined}
            >
              <ChatAvatar name={chat.name} jid={chat.jid} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-white truncate">
                    {chat.name ?? chat.jid}
                  </p>
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    {chat.last_message_at && (
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(chat.last_message_at)}
                      </span>
                    )}
                    {chat.unread_count > 0 && (
                      <span className="text-xs bg-green-600 text-white rounded-full px-1.5 py-0.5 leading-none">
                        {chat.unread_count}
                      </span>
                    )}
                  </div>
                </div>
                {operatorRole === "admin" && chat.wa_sessions && (
                  <p className="text-xs text-gray-600 truncate mt-0.5">
                    {chat.wa_sessions.label ?? chat.wa_sessions.phone_number}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
