"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { formatTime } from "@/lib/utils";
import { displayChatName } from "@/lib/chat-display";
import MessageComposer from "@/components/message-composer";
import ConversationSummary from "@/components/conversation-summary";
import ChatAvatar from "@/components/chat-avatar";
import { createClient } from "@/lib/supabase/client";
import {
  Check,
  CheckCheck,
  Reply,
  Ban,
  Image as ImageIcon,
  Video,
  Music,
  Paperclip,
  MapPin,
  User,
  BarChart2,
  Smile,
  RefreshCw,
} from "lucide-react";

interface MediaFile {
  storage_path: string | null;
  mime_type: string | null;
  download_status: string;
}

interface Message {
  id: string;
  message_id: string;
  type: string;
  body: string | null;
  caption: string | null;
  from_me: boolean;
  timestamp: string;
  deleted_at: string | null;
  edited_at: string | null;
  delivery_status: string | null;
  reaction_to: string | null;
  media_files: MediaFile[] | null;
  signedUrl: string | null;
  contacts: { push_name: string | null; name: string | null } | null;
}

interface Chat {
  id: string;
  name: string | null;
  jid: string;
  session_id: string;
  avatar_url: string | null;
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
  const [chatName, setChatName] = useState(chat.name);
  const [avatarUrl, setAvatarUrl] = useState(chat.avatar_url);
  const [syncingName, setSyncingName] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const mediaRetryRef = useRef(0);
  const searchParams = useSearchParams();
  const targetMsg = searchParams.get("msg");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    setMessages(initial);
    setHasMore(initialHasMore);
  }, [initial, initialHasMore]);

  async function handleSyncName() {
    setSyncingName(true);
    try {
      const res = await fetch(`/api/chats/${chat.id}/sync-name`, { method: "POST" });
      const data = await res.json() as { ok: boolean; name?: string; avatarUrl?: string };
      if (data.ok && data.name) setChatName(data.name);
      if (data.ok && data.avatarUrl) setAvatarUrl(data.avatarUrl);
    } catch { /* ignore */ } finally {
      setSyncingName(false);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
    fetch(`/api/chats/${chat.id}/read`, { method: "POST" }).catch(() => undefined);
  }, [chat.id]);

  const refreshMessages = useCallback(async () => {
    const res = await fetch(`/api/messages?chatId=${chat.id}&limit=50`);
    if (!res.ok) return;
    const { messages: fresh } = await res.json() as { messages: Message[] };
    setMessages((prev) => {
      // Manter placeholders otimistas que ainda não têm correspondente real no banco
      const optimistics = prev.filter((m) => m.id.startsWith("opt_"));
      if (optimistics.length === 0) return fresh;
      // Se há mensagens from_me recentes no fresh, o webhook chegou — descartar placeholders
      const newestOpt = Math.max(...optimistics.map((m) => new Date(m.timestamp).getTime()));
      const webhookArrived = fresh.some(
        (m) => m.from_me && new Date(m.timestamp).getTime() >= newestOpt - 10_000,
      );
      return webhookArrived ? fresh : [...fresh, ...optimistics];
    });
    setHasMore(fresh.length === 50);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, [chat.id]);

  const handleSent = useCallback((opt: { text?: string; mediaType?: string; caption?: string }) => {
    const optimistic: Message = {
      id: `opt_${Date.now()}`,
      message_id: `opt_${Date.now()}`,
      type: opt.mediaType ?? "text",
      body: opt.text ?? null,
      caption: opt.caption ?? null,
      from_me: true,
      timestamp: new Date().toISOString(),
      deleted_at: null,
      edited_at: null,
      delivery_status: "pending",
      reaction_to: null,
      media_files: null,
      signedUrl: null,
      contacts: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

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

  // Mídia recém-enviada/recebida pode ainda estar baixando (download_status != done):
  // o link assinado vem null. media_files atualiza fora da tabela `messages`, então o
  // realtime não dispara — re-buscar algumas vezes até o download concluir.
  useEffect(() => {
    const MEDIA = ["image", "video", "audio", "ptt", "document", "sticker"];
    const hasPending = messages.some(
      (m) =>
        MEDIA.includes(m.type) &&
        !m.signedUrl &&
        (m.media_files?.[0]?.download_status ?? "pending") !== "failed",
    );
    if (!hasPending) {
      mediaRetryRef.current = 0;
      return;
    }
    if (mediaRetryRef.current >= 6) return;
    const t = setTimeout(() => {
      mediaRetryRef.current += 1;
      void refreshMessages();
    }, 3000);
    return () => clearTimeout(t);
  }, [messages, refreshMessages]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-messages-${chat.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        () => { void refreshMessages(); },
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
  }, [chat.id, refreshMessages]);

  // Rolar até e destacar a mensagem-alvo (vindo de ?msg=, ex: clique num alerta)
  useEffect(() => {
    if (!targetMsg) return;
    const el = document.getElementById(`m-${targetMsg}`);
    if (!el) return; // ainda não carregada (mensagem antiga) — abre a conversa normalmente
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(targetMsg);
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [targetMsg, messages]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ChatAvatar name={chatName} jid={chat.jid} avatarUrl={avatarUrl} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayChatName(chatName, chat.jid)}</p>
            <p className="text-xs text-gray-500 truncate">{chat.jid}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConversationSummary chatId={chat.id} />
          <button
            onClick={handleSyncName}
            disabled={syncingName}
            title="Sincronizar nome do contato/grupo"
            className="text-gray-600 hover:text-gray-300 disabled:opacity-40 transition-colors p-1"
          >
            <RefreshCw size={14} className={syncingName ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        <div ref={topSentinelRef} className="h-1" />
        {loadingMore && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-gray-500 animate-pulse">Carregando...</span>
          </div>
        )}
        {(() => {
          // Agrupar reações por mensagem-alvo: evolutionMsgId → { emoji: count }
          const reactionMap = new Map<string, Record<string, number>>();
          for (const msg of messages) {
            if (msg.type === "reaction" && msg.reaction_to && msg.body) {
              const existing = reactionMap.get(msg.reaction_to) ?? {};
              existing[msg.body] = (existing[msg.body] ?? 0) + 1;
              reactionMap.set(msg.reaction_to, existing);
            }
          }
          // Exibir apenas mensagens não-reação
          return messages
            .filter((msg) => msg.type !== "reaction")
            .map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isGroup={isGroup}
                highlighted={msg.id === highlightId}
                reactions={reactionMap.get(msg.message_id) ?? null}
                onReply={(m) => setQuotedMessage({
                  id: m.id,
                  body: m.body ?? m.caption,
                  senderName: m.from_me ? "Você" : (m.contacts?.push_name ?? m.contacts?.name ?? null),
                })}
              />
            ));
        })()}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        chatId={chat.id}
        onSent={handleSent}
        quotedMessage={quotedMessage}
        onClearQuote={() => setQuotedMessage(null)}
      />
    </div>
  );
}

function DeliveryTicks({ status }: { status: string | null }) {
  if (!status || status === "pending") {
    return <Check size={12} className="ml-1 opacity-60 inline" />;
  }
  if (status === "server" || status === "device") {
    return <CheckCheck size={12} className="ml-1 opacity-60 inline" />;
  }
  if (status === "read" || status === "played") {
    return <CheckCheck size={12} className="ml-1 text-blue-300 inline" />;
  }
  return null;
}

function MessageBubble({ message, isGroup, reactions, onReply, highlighted }: { message: Message; isGroup: boolean; reactions: Record<string, number> | null; onReply: (m: Message) => void; highlighted?: boolean }) {
  const { from_me, type, body, caption, timestamp, media_files, signedUrl, contacts, deleted_at, edited_at, delivery_status } = message;
  const media = media_files?.[0] ?? null;
  const senderName = contacts?.push_name ?? contacts?.name ?? null;

  return (
    <div
      id={`m-${message.id}`}
      className={`flex items-end gap-1 group rounded-lg transition-colors ${from_me ? "justify-end" : "justify-start"} ${highlighted ? "ring-2 ring-yellow-400 bg-yellow-400/5" : ""}`}
    >
      {from_me && (
        <button
          onClick={() => onReply(message)}
          className="text-gray-600 hover:text-gray-300 p-2 -m-1 transition-opacity opacity-0 group-hover:opacity-100 shrink-0"
          title="Responder"
          aria-label="Responder mensagem"
        >
          <Reply size={14} />
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
          <p className="italic opacity-40 text-xs flex items-center gap-1">
            <Ban size={12} />
            Mensagem apagada
          </p>
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
        {reactions && Object.keys(reactions).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 ${from_me ? "justify-end" : "justify-start"}`}>
            {Object.entries(reactions).map(([emoji, count]) => (
              <span
                key={emoji}
                className="inline-flex items-center gap-0.5 bg-black/30 rounded-full px-1.5 py-0.5 text-xs"
              >
                <span>{emoji}</span>
                {count > 1 && <span className="opacity-70">{count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {!from_me && (
        <button
          onClick={() => onReply(message)}
          className="text-gray-600 hover:text-gray-300 p-2 -m-1 transition-opacity opacity-0 group-hover:opacity-100 shrink-0"
          title="Responder"
          aria-label="Responder mensagem"
        >
          <Reply size={14} />
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
      if (res.status === 503) {
        throw new Error("IA não configurada. Peça ao administrador para ativá-la em Configurações.");
      }
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
    return (
      <div>
        <p className="italic opacity-50 text-xs flex items-center gap-1.5">
          <ImageIcon size={13} />
          Imagem não disponível
        </p>
        {caption && <p className="mt-1 text-sm whitespace-pre-wrap break-words">{caption}</p>}
      </div>
    );
  }

  if (type === "sticker") {
    if (signedUrl) {
      return <img src={signedUrl} alt="sticker" className="w-28 h-28 object-contain" />;
    }
    return <Smile size={32} className="opacity-50" />;
  }

  if (type === "video") {
    if (signedUrl) {
      return (
        <video controls className="rounded max-w-xs max-h-48">
          <source src={signedUrl} type={media?.mime_type ?? "video/mp4"} />
        </video>
      );
    }
    return (
      <div>
        <p className="italic opacity-70 text-xs flex items-center gap-1.5">
          <Video size={13} />
          Vídeo não disponível
        </p>
        {caption && <p className="mt-1 text-sm whitespace-pre-wrap break-words">{caption}</p>}
      </div>
    );
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
    return (
      <p className="italic opacity-70 text-xs flex items-center gap-1.5">
        <Music size={13} />
        Áudio não disponível
      </p>
    );
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
          <Paperclip size={14} />
          <span className="break-all">{caption ?? `documento.${ext}`}</span>
        </a>
      );
    }
    return (
      <p className="italic opacity-70 text-xs flex items-center gap-1.5">
        <Paperclip size={13} />
        {caption ?? "Documento não disponível"}
      </p>
    );
  }  // caption já está no fallback do documento acima

  if (type === "location") {
    const name = body ?? "Localização";
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-blue-300 hover:text-blue-200"
      >
        <MapPin size={14} />
        <span className="underline">{name}</span>
      </a>
    );
  }

  if (type === "contact") {
    return (
      <div className="flex items-center gap-2 bg-black/20 rounded px-2 py-1">
        <User size={18} className="opacity-70 shrink-0" />
        <span className="text-sm font-medium">{body ?? "Contato"}</span>
      </div>
    );
  }

  if (type === "poll") {
    return (
      <div className="flex items-center gap-2 opacity-70">
        <BarChart2 size={14} />
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
