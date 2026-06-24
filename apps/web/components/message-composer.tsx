"use client";

import { useState, useRef, KeyboardEvent } from "react";

interface QuotedMessage {
  id: string;           // message_id do WhatsApp
  body: string | null;
  senderName: string | null;
}

interface MessageComposerProps {
  chatId: string;
  onSent?: () => void;
  quotedMessage?: QuotedMessage | null;
  onClearQuote?: () => void;
}

export default function MessageComposer({ chatId, onSent, quotedMessage, onClearQuote }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(payload: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Erro ${res.status}`);
      }
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSendText() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    await send({ text: trimmed, quotedMessageId: quotedMessage?.id });
    setText("");
    onClearQuote?.();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const mediaType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "document";

      await send({
        mediaBase64: base64,
        mediaType,
        mediaMime: file.type,
        fileName: file.name,
        caption: text.trim() || undefined,
        quotedMessageId: quotedMessage?.id,
      });
      setText("");
      onClearQuote?.();
    };
    reader.readAsDataURL(file);
    // Reset input para permitir re-envio do mesmo arquivo
    e.target.value = "";
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950 shrink-0">
      {/* Quote preview */}
      {quotedMessage && (
        <div className="flex items-start gap-2 px-4 pt-3">
          <div className="flex-1 border-l-2 border-green-500 pl-2 text-xs text-gray-400 truncate">
            <span className="text-green-400 font-medium">{quotedMessage.senderName ?? "Você"}</span>
            <p className="truncate opacity-70">{quotedMessage.body ?? "Mídia"}</p>
          </div>
          <button onClick={onClearQuote} className="text-gray-600 hover:text-white text-lg leading-none">×</button>
        </div>
      )}

      <div className="flex items-end gap-2 px-4 py-3">
        {/* Botão de arquivo */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={sending}
          className="shrink-0 text-gray-500 hover:text-white p-1.5 rounded transition-colors"
          title="Enviar arquivo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile}
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx" />

        {/* Campo de texto */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem..."
          rows={1}
          className="flex-1 resize-none bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 placeholder-gray-500 max-h-32 overflow-y-auto"
          style={{ minHeight: 40 }}
        />

        {/* Botão enviar */}
        <button
          onClick={handleSendText}
          disabled={sending || !text.trim()}
          className="shrink-0 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg p-2 transition-colors"
          title="Enviar (Enter)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
