"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Session {
  id: string;
  phone_number: string;
  label: string | null;
  status: string;
  last_seen_at: string | null;
  evolution_instance_name: string | null;
  qr_code: string | null;
  webhook_secret: string | null;
}

const statusColors: Record<string, string> = {
  connected: "bg-green-500",
  disconnected: "bg-gray-500",
  connecting: "bg-yellow-500",
  banned: "bg-red-500",
};

export default function SessionCard({ session: initial }: { session: Session }) {
  const [session, setSession] = useState(initial);
  const [actionLoading, setActionLoading] = useState(false);
  const [rotateLoading, setRotateLoading] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`session-${initial.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wa_sessions",
          filter: `id=eq.${initial.id}`,
        },
        (payload) => setSession((prev) => ({ ...prev, ...payload.new })),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [initial.id]);

  async function handleConnect() {
    if (!session.evolution_instance_name) return;
    setActionLoading(true);
    await fetch("/api/sessions/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id }),
    });
    setActionLoading(false);
  }

  async function handleDisconnect() {
    if (!session.evolution_instance_name) return;
    setActionLoading(true);
    await fetch("/api/sessions/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id }),
    });
    setActionLoading(false);
  }

  async function handleRotateSecret() {
    setRotateLoading(true);
    const res = await fetch(`/api/sessions/${session.id}/rotate-secret`, { method: "POST" });
    if (res.ok) {
      const data = await res.json() as { webhook_secret: string; webhook_url: string };
      setSession((prev) => ({ ...prev, webhook_secret: data.webhook_secret }));
      setRevealedSecret(data.webhook_secret);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealedSecret(null), 10_000);
    }
    setRotateLoading(false);
  }

  useEffect(() => {
    return () => { if (revealTimer.current) clearTimeout(revealTimer.current); };
  }, []);

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
  }

  const maskedSecret = session.webhook_secret
    ? `${session.webhook_secret.slice(0, 8)}...`
    : null;

  const dotColor = statusColors[session.status] ?? "bg-gray-500";
  const qrBase64 = session.qr_code;
  const showQr = session.status === "connecting" && qrBase64;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">
            {session.label ?? session.phone_number}
          </p>
          <p className="text-xs text-gray-500">{session.phone_number}</p>
          {session.evolution_instance_name && (
            <p className="text-xs text-gray-600 mt-0.5">{session.evolution_instance_name}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            <span className="text-xs text-gray-400 capitalize">{session.status}</span>
          </div>
          {session.status === "disconnected" && session.evolution_instance_name && (
            <button
              onClick={handleConnect}
              disabled={actionLoading}
              className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              Conectar
            </button>
          )}
          {session.status === "connected" && (
            <button
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              Desconectar
            </button>
          )}
        </div>
      </div>

      {session.last_seen_at && (
        <p className="text-xs text-gray-600">
          Visto: {new Date(session.last_seen_at).toLocaleString("pt-BR")}
        </p>
      )}

      {showQr && (
        <div className="space-y-2">
          <p className="text-xs text-yellow-400 animate-pulse">
            Escaneie o QR Code com o WhatsApp
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
            alt="QR Code WhatsApp"
            className="w-48 h-48 rounded border border-gray-700 bg-white p-2"
          />
        </div>
      )}

      {session.status === "connecting" && !qrBase64 && (
        <p className="text-xs text-yellow-400 animate-pulse">
          Gerando QR Code...
        </p>
      )}

      <div className="border-t border-gray-800 pt-3 space-y-2">
        <p className="text-xs font-medium text-gray-400">Configuração do Webhook</p>

        <div className="space-y-1">
          <p className="text-xs text-gray-600">URL</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono truncate flex-1 bg-gray-800 px-2 py-1 rounded">
              {webhookUrl}
            </span>
            <button
              onClick={() => copyToClipboard(webhookUrl)}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors shrink-0"
            >
              Copiar
            </button>
          </div>
        </div>

        {maskedSecret && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600">Secret</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono flex-1 bg-gray-800 px-2 py-1 rounded">
                {revealedSecret ?? maskedSecret}
              </span>
              {revealedSecret && (
                <button
                  onClick={() => copyToClipboard(revealedSecret)}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors shrink-0"
                >
                  Copiar
                </button>
              )}
            </div>
            {revealedSecret && (
              <p className="text-xs text-yellow-500">
                Salve agora — será ocultado em breve.
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleRotateSecret}
          disabled={rotateLoading}
          className="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-md disabled:opacity-50 transition-colors"
        >
          {rotateLoading ? "Regenerando..." : "Regenerar Secret"}
        </button>
      </div>
    </div>
  );
}
