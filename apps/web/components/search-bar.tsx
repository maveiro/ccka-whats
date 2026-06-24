"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/utils";

interface MessageResult {
  id: string;
  body: string | null;
  caption: string | null;
  type: string;
  from_me: boolean;
  timestamp: string;
  chat_id: string;
  chats: { id: string; name: string | null; jid: string } | null;
  contacts: { push_name: string | null; name: string | null } | null;
}

interface ChatResult {
  id: string;
  name: string | null;
  jid: string;
}

interface SearchResults {
  messages: MessageResult[];
  chats: ChatResult[];
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
      if (res.ok) setResults(await res.json() as SearchResults);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.length < 2) { setResults(null); return; }
    timerRef.current = setTimeout(() => search(query), 300);
    return () => clearTimeout(timerRef.current);
  }, [query, search]);

  // Fechar ao clicar fora
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const hasResults = results && (results.messages.length > 0 || results.chats.length > 0);

  function highlight(text: string | null, q: string) {
    if (!text) return null;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar mensagens..."
          className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 placeholder-gray-500"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          {!hasResults && !loading && (
            <p className="text-center text-xs text-gray-500 py-4">Nenhum resultado para "{query}"</p>
          )}

          {results?.chats && results.chats.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wider">Conversas</p>
              {results.chats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/dashboard/chat/${chat.id}`}
                  onClick={() => { setOpen(false); setQuery(""); }}
                  className="block px-3 py-2 hover:bg-gray-800 transition-colors"
                >
                  <p className="text-sm text-white">{highlight(chat.name ?? chat.jid, query)}</p>
                  {chat.name && <p className="text-xs text-gray-500">{chat.jid}</p>}
                </Link>
              ))}
            </div>
          )}

          {results?.messages && results.messages.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wider">Mensagens</p>
              {results.messages.map((msg) => {
                const text = msg.body ?? msg.caption;
                const sender = msg.from_me ? "Você" : (msg.contacts?.push_name ?? msg.contacts?.name ?? "");
                return (
                  <Link
                    key={msg.id}
                    href={`/dashboard/chat/${msg.chat_id}`}
                    onClick={() => { setOpen(false); setQuery(""); }}
                    className="block px-3 py-2 hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400 truncate">
                          {msg.chats?.name ?? msg.chats?.jid ?? "Chat"}
                          {sender && <span className="ml-1 text-gray-500">· {sender}</span>}
                        </p>
                        <p className="text-sm text-white truncate mt-0.5">
                          {highlight(text ?? `[${msg.type}]`, query)}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{formatTime(msg.timestamp)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
