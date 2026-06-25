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
  last_message_body: string | null;
  unread_count: number;
  session_id: string;
  wa_sessions: { label: string | null; phone_number: string; status: string } | null;
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
      <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center shrink-0`} aria-hidden="true">
        <Users size={18} className="text-white opacity-90" />
      </div>
    );
  }

  const initial = (name ?? jid).charAt(0).toUpperCase();
  return (
    <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-sm font-bold text-white shrink-0`} aria-hidden="true">
      {initial}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  connected:    "bg-green-500",
  connecting:   "bg-yellow-400 animate-pulse",
  disconnected: "bg-gray-500",
  banned:       "bg-red-500",
};

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
}

type FilterTab = "all" | "groups" | "contacts";

interface SessionInfo {
  id: string;
  label: string | null;
  phone_number: string;
  status: string;
  unread: number;
}

export default function ChatList({ chats: initial, operatorRole }: ChatListProps) {
  const pathname = usePathname();
  const [chats, setChats] = useState(initial);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selectedSession, setSelectedSession] = useState<string>("all");

  useEffect(() => { setChats(initial); }, [initial]);

  // Derive unique sessions from chats (stable order by first appearance)
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();
  for (const c of chats) {
    if (c.session_id && !seen.has(c.session_id)) {
      seen.add(c.session_id);
      sessions.push({
        id: c.session_id,
        label: c.wa_sessions?.label ?? null,
        phone_number: c.wa_sessions?.phone_number ?? c.session_id,
        status: c.wa_sessions?.status ?? "disconnected",
        unread: 0,
      });
    }
  }
  // Count unread per session
  for (const c of chats) {
    const s = sessions.find((s) => s.id === c.session_id);
    if (s) s.unread += c.unread_count ?? 0;
  }

  const showSessionFilter = sessions.length > 1;

  const filteredChats = chats.filter((c) => {
    if (selectedSession !== "all" && c.session_id !== selectedSession) return false;
    if (filter === "groups") return c.jid.endsWith("@g.us");
    if (filter === "contacts") return !c.jid.endsWith("@g.us");
    return true;
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("chat-list-updates")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats" }, (payload) => {
        setChats((prev) =>
          prev.map((c) =>
            c.id === payload.new.id
              ? {
                  ...c,
                  unread_count: payload.new.unread_count,
                  last_message_at: payload.new.last_message_at,
                  last_message_body: payload.new.last_message_body ?? c.last_message_body,
                  name: payload.new.name ?? c.name,
                }
              : c,
          ).sort((a, b) => {
            const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return tb - ta;
          }),
        );
      })
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

  const typeTabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "groups", label: "Grupos" },
    { key: "contacts", label: "Contatos" },
  ];

  return (
    <div className="w-72 border-r border-gray-800 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-800 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">Conversas</h2>
        <SearchBar />

        {/* Session pills — only when multiple instances */}
        {showSessionFilter && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none" role="tablist" aria-label="Filtrar por número">
            <button
              role="tab"
              aria-selected={selectedSession === "all"}
              onClick={() => setSelectedSession("all")}
              className={`shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
                selectedSession === "all"
                  ? "bg-gray-700 border-gray-600 text-white"
                  : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700"
              }`}
            >
              Todos
              {chats.reduce((s, c) => s + (c.unread_count ?? 0), 0) > 0 && (
                <span className="bg-green-600 text-white text-[10px] rounded-full px-1 leading-none py-0.5">
                  {chats.reduce((s, c) => s + (c.unread_count ?? 0), 0)}
                </span>
              )}
            </button>
            {sessions.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={selectedSession === s.id}
                onClick={() => setSelectedSession(s.id)}
                className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
                  selectedSession === s.id
                    ? "bg-gray-700 border-gray-600 text-white"
                    : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[s.status] ?? "bg-gray-500"}`} />
                <span className="truncate max-w-[90px]">
                  {s.label ?? formatPhone(s.phone_number)}
                </span>
                {s.unread > 0 && (
                  <span className="bg-green-600 text-white text-[10px] rounded-full px-1 leading-none py-0.5">
                    {s.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Type filter */}
        <div className="flex gap-1">
          {typeTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 text-xs py-1 rounded-md font-medium transition-colors ${
                filter === tab.key ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" role="list" aria-label="Lista de conversas">
        {filteredChats.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <p className="text-xs text-gray-600">Nenhuma conversa nesta categoria</p>
          </div>
        )}
        {filteredChats.map((chat) => {
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
                {chat.last_message_body && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {chat.last_message_body}
                  </p>
                )}
                {operatorRole === "admin" && chat.wa_sessions && (
                  <p className="text-xs text-gray-700 truncate mt-0.5">
                    {chat.wa_sessions.label ?? formatPhone(chat.wa_sessions.phone_number)}
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
