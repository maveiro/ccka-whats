"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { formatTime } from "@/lib/utils";
import MessageComposer from "@/components/message-composer";
import { createClient } from "@/lib/supabase/client";

interface MediaFile {
  storage_path: string | null;
  mime_type: string | null;
  download_status: string;
}

interface Message {
  id: string;
  type: string;
  body: string | null;
  caption: string | null;
  from_me: boolean;
  timestamp: string;
  deleted_at: string | null;
  edited_at: string | null;
  delivery_status: string | null;
  media_files: MediaFile[] | null;
  signedUrl: string | null;
  contacts: { push_name: string | null; name: string | null } | null;
}

interface Chat {
  id: string;
  name: string | null;
  jid: string;
  session_id: string;
}

interface ChatViewProps {
  chat: Chat;
  messages: Message[];
  isGroup: boolean;
  hasMore: boolean;
}

interface QuotedMessage {
  id: string;
  body: string | null;
  senderName: string | null;
}

export default function ChatView({ chat, messages: initial, isGroup, hasMore: initialHasMore }: ChatViewProps) {
  const [messages, setMessages] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<QuotedMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Sincronizar quando props mudam (navegação entre chats)
  useEffect(() => {
    setMessages(initial);
    setHasMore(initialHasMore);
  }, [initial, initialHasMore]);

  // Scroll para o final + zerar unread ao abrir o chat
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
    fetch(`/api/chats/${chat.id}/read`, { method: "POST" }).catch(() => undefined);
  }, [chat.id]);

  const refreshMessages = useCallback(async () => {
    const res = await fetch(`/api/messages?chatId=${chat.id}&limit=50`);
    if (!res.ok) return;
    const { messages: fresh } = await res.json() as { messages: Message[] };
    setMessages(fresh);
    setHasMore(fresh.length === 50);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, [chat.id]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);

    const oldest = messages[0];
    try {
      const res = await fetch(
        `/api/messages?chatId=${chat.id}&before=${encodeURIComponent(oldest.timestamp)}&limit=50`
      );
      if (!res.ok) return;
      const { messages: older } = await res.json() as { messages: Message[] };
      if (older.length === 0) {
        setHasMore(false);
      } else {
        // Preservar posição de scroll ao prepend
        const list = listRef.current;
        const prevHeight = list?.scrollHeight ?? 0;
        setMessages((prev) => [...older, ...prev]);
        setHasMore(older.length === 50);
        requestAnimationFrame(() => {
          if (list) list.scrollTop = list.scrollHeight - prevHeight;
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [chat.id, messages, hasMore, loadingMore]);

  // Scroll infinito: IntersectionObserver no sentinel do topo
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          void loadMore();
        }
      },
      { root: listRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  // Realtime: receber novas mensagens do chat ativo
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:chat_id=eq.${chat.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        async (payload) => {
          // Buscar a mensagem completa com signed URL
          const res = await fetch(`/api/messages?chatId=${chat.id}&limit=1`);
          if (!res.ok) return;
          const { messages: fresh } = await res.json() as { messages: Message[] };
          const newMsg = fresh.find((m) => m.id === payload.new.id) ?? fresh[fresh.length - 1];
          if (!newMsg) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id ? { ...m, ...payload.new } : m,
            ),
          );
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [chat.id]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 shrink-0">
        <p className="text-sm font-medium text-white">{chat.name ?? chat.jid}</p>
        <p className="text-xs text-gray-500">{chat.jid}</p>
      </div>

      {/* Mensagens */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {/* Sentinel invisível: ao entrar na viewport dispara loadMore */}
        <div ref={topSentinelRef} className="h-1" />
        {loadingMore && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-gray-500 animate-pulse">Carregando...</span>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isGroup={isGroup}
            onReply={(m) => setQuotedMessage({
              id: m.id,
              body: m.body ?? m.caption,
              senderName: m.from_me ? "Você" : (m.contacts?.push_name ?? m.contacts?.name ?? null),
            })}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compositor */}
      <MessageComposer
        chatId={chat.id}
        onSent={refreshMessages}
        quotedMessage={quotedMessage}
        onClearQuote={() => setQuotedMessage(null)}
      />
    </div>
  );
}

function DeliveryTicks({ status }: { status: string | null }) {
  if (!status || status === "pending") {
    return <span className="ml-1 opacity-60">✓</span>;
  }
  if (status === "server") {
    return <span className="ml-1 opacity-60">✓✓</span>;
  }
  if (status === "device") {
    return <span className="ml-1 opacity-60">✓✓</span>;
  }
  if (status === "read" || status === "played") {
    return <span className="ml-1 text-blue-300">✓✓</span>;
  }
  return null;
}

function MessageBubble({ message, isGroup, onReply }: { message: Message; isGroup: boolean; onReply: (m: Message) => void }) {
  const [hovered, setHovered] = useState(false);
  const { from_me, type, body, caption, timestamp, media_files, signedUrl, contacts, deleted_at, edited_at, delivery_status } = message;
  const media = media_files?.[0] ?? null;
  const senderName = contacts?.push_name ?? contacts?.name ?? null;

  // Reações ficam sem balão — só emoji flutuante
  if (type === "reaction" && !deleted_at) {
    return (
      <div className={`flex ${from_me ? "justify-end" : "justify-start"}`}>
        <span className="text-2xl" title={from_me ? "Você reagiu" : senderName ?? undefined}>
          {body ?? "👍"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-end gap-1 ${from_me ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Botão reply — lado esquerdo para mensagens próprias */}
      {from_me && hovered && (
        <button
          onClick={() => onReply(message)}
          className="text-gray-600 hover:text-gray-300 p-1 transition-colors shrink-0"
          title="Responder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      )}

      <div
        className={`max-w-sm px-3 py-2 rounded-lg text-sm ${
          from_me ? "bg-green-700 text-white" : "bg-gray-800 text-gray-100"
        }`}
      >
        {isGroup && !from_me && senderName && (
          <p className="text-xs font-medium text-green-400 mb-1">{senderName}</p>
        )}

        {deleted_at ? (
          <p className="italic opacity-40 text-xs">🚫 Mensagem apagada</p>
        ) : (
          <MessageContent
            messageId={message.id}
            type={type}
            body={body}
            caption={caption}
            media={media}
            signedUrl={signedUrl}
          />
        )}

        <p className="text-right text-xs mt-1 opacity-60 flex items-center justify-end gap-0.5">
          {edited_at && <span className="italic opacity-70 mr-1">· editada</span>}
          {formatTime(timestamp)}
          {from_me && !deleted_at && <DeliveryTicks status={delivery_status} />}
        </p>
      </div>

      {/* Botão reply — lado direito para mensagens recebidas */}
      {!from_me && hovered && (
        <button
          onClick={() => onReply(message)}
          className="text-gray-600 hover:text-gray-300 p-1 transition-colors shrink-0"
          title="Responder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AudioTranscribeButton({ messageId }: { messageId: string }) {
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transcribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${messageId}/transcribe`, { method: "POST" });
      const data = await res.json() as { transcript?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro");
      setTranscript(data.transcript ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (transcript) return <p className="text-xs mt-1 italic opacity-80">{transcript}</p>;
  return (
    <div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      <button
        onClick={transcribe}
        disabled={loading}
        className="text-xs text-blue-400 hover:text-blue-300 mt-1 disabled:opacity-50"
      >
        {loading ? "Transcrevendo..." : "Transcrever"}
      </button>
    </div>
  );
}

function MessageContent({
  messageId, type, body, caption, media, signedUrl,
}: {
  messageId: string;
  type: string;
  body: string | null;
  caption: string | null;
  media: MediaFile | null;
  signedUrl: string | null;
}) {
  if (type === "text") {
    return <p className="whitespace-pre-wrap break-words">{body}</p>;
  }

  if (type === "image") {
    if (signedUrl) {
      return (
        <div>
          <img src={signedUrl} alt="imagem" className="rounded max-w-xs max-h-60 object-cover cursor-pointer"
               onClick={() => window.open(signedUrl, "_blank")} />
          {caption && <p className="mt-1 text-xs opacity-80">{caption}</p>}
        </div>
      );
    }
    return <p className="italic opacity-50 text-xs">🖼 Imagem não disponível</p>;
  }

  if (type === "sticker") {
    if (signedUrl) {
      return (
        <img src={signedUrl} alt="sticker" className="w-28 h-28 object-contain" />
      );
    }
    return <span className="text-2xl">🎭</span>;
  }

  if (type === "video") {
    if (signedUrl) {
      return (
        <video controls className="rounded max-w-xs max-h-48">
          <source src={signedUrl} type={media?.mime_type ?? "video/mp4"} />
        </video>
      );
    }
    return <p className="italic opacity-70 text-xs">🎥 Vídeo não disponível</p>;
  }

  if (type === "audio" || type === "ptt") {
    if (signedUrl) {
      return (
        <div>
          <audio controls className="max-w-xs" style={{ height: 36 }}>
            <source src={signedUrl} type={media?.mime_type ?? "audio/ogg"} />
          </audio>
          {body
            ? <p className="text-xs mt-1 opacity-80 italic">{body}</p>
            : <AudioTranscribeButton messageId={messageId} />
          }
        </div>
      );
    }
    return <p className="italic opacity-70 text-xs">🎵 Áudio não disponível</p>;
  }

  if (type === "document") {
    const ext = media?.mime_type ? mimeToExt(media.mime_type) : "arquivo";
    if (signedUrl) {
      return (
        <a
          href={signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="flex items-center gap-2 text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
        >
          <span>📎</span>
          <span className="break-all">{caption ?? `documento.${ext}`}</span>
        </a>
      );
    }
    return <p className="italic opacity-70 text-xs">📎 {caption ?? "Documento não disponível"}</p>;
  }

  if (type === "location") {
    const name = body ?? "Localização";
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-blue-300 hover:text-blue-200"
      >
        <span>📍</span>
        <span className="underline">{name}</span>
      </a>
    );
  }

  if (type === "contact") {
    return (
      <div className="flex items-center gap-2 bg-black/20 rounded px-2 py-1">
        <span className="text-xl">👤</span>
        <span className="text-sm font-medium">{body ?? "Contato"}</span>
      </div>
    );
  }

  if (type === "poll") {
    return (
      <div className="flex items-center gap-2 opacity-70">
        <span>📊</span>
        <span className="italic">{body ?? "Enquete"}</span>
      </div>
    );
  }

  if (type === "interactive") {
    return (
      <div>
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
        <p className="text-xs opacity-50 mt-1 italic">Mensagem interativa</p>
      </div>
    );
  }

  // system/protocol — mostrar discretamente
  if (["system", "protocol", "unknown"].includes(type)) {
    return <p className="italic opacity-30 text-xs text-center">— mensagem de sistema —</p>;
  }

  return <p className="italic opacity-50 text-xs">[{type}]</p>;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  };
  return map[mime] ?? mime.split("/")[1] ?? "arquivo";
}
