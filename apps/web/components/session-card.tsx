"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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

const statusConfig: Record<string, { dot: string; label: string; text: string }> = {
  connected:    { dot: "bg-green-500",  label: "Conectado",    text: "text-green-400" },
  disconnected: { dot: "bg-gray-500",   label: "Desconectado", text: "text-gray-400" },
  connecting:   { dot: "bg-yellow-400 animate-pulse", label: "Conectando", text: "text-yellow-400" },
  banned:       { dot: "bg-red-500",    label: "Banido",       text: "text-red-400" },
};

export default function SessionCard({ session: initial }: { session: Session }) {
  const [session, setSession]           = useState(initial);
  const [actionLoading, setActionLoading] = useState(false);
  const [rotateLoading, setRotateLoading] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [webhookOpen, setWebhookOpen]   = useState(false);
  const [copied, setCopied]             = useState<"url" | "secret" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleted, setDeleted]           = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`session-${initial.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wa_sessions", filter: `id=eq.${initial.id}` },
        (payload) => setSession((prev) => ({ ...prev, ...payload.new })))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [initial.id]);

  // Auto-abre webhook se o secret foi recém revelado
  useEffect(() => { if (revealedSecret) setWebhookOpen(true); }, [revealedSecret]);

  // Polling: buscar QR a cada 5s quando está connecting sem QR
  useEffect(() => {
    if (session.status !== "connecting" || session.qr_code) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}/qr`);
        const data = await res.json() as { qrCode?: string | null };
        if (data.qrCode) setSession((prev) => ({ ...prev, qr_code: data.qrCode!, status: "connecting" }));
      } catch { /* silencioso */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [session.id, session.status, session.qr_code]);

  useEffect(() => {
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function handleConnect() {
    if (!session.evolution_instance_name) return;
    setActionLoading(true);
    await fetch("/api/sessions/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) });
    setActionLoading(false);
  }

  async function handleCheckStatus() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/status`, { method: "POST" });
      const data = await res.json() as { newStatus?: string };
      if (data.newStatus) setSession((prev) => ({ ...prev, status: data.newStatus! }));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDisconnect() {
    if (!session.evolution_instance_name) return;
    setActionLoading(true);
    await fetch("/api/sessions/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) });
    setActionLoading(false);
  }

  async function handleRefreshQr() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/qr`);
      const data = await res.json() as { qrCode?: string | null };
      if (data.qrCode) setSession((prev) => ({ ...prev, qr_code: data.qrCode!, status: "connecting" }));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRotateSecret() {
    setRotateLoading(true);
    const res = await fetch(`/api/sessions/${session.id}/rotate-secret`, { method: "POST" });
    if (res.ok) {
      const data = await res.json() as { webhook_secret: string };
      setSession((prev) => ({ ...prev, webhook_secret: data.webhook_secret }));
      setRevealedSecret(data.webhook_secret);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealedSecret(null), 10_000);
    }
    setRotateLoading(false);
  }

  async function handleDelete() {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleteLoading(true);
    const res = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleted(true);
    } else {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      toast.error("Não foi possível excluir a sessão", {
        description: data?.error ?? `Erro inesperado (${res.status})`,
      });
      setDeleteLoading(false);
      setDeleteConfirm(false);
    }
  }

  function copyToClipboard(text: string, which: "url" | "secret") {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  const cfg = statusConfig[session.status] ?? statusConfig.disconnected;
  const maskedSecret = session.webhook_secret ? `${session.webhook_secret.slice(0, 8)}...` : null;
  const showQr = session.status === "connecting" && session.qr_code;
  const qrSrc = session.qr_code
    ? (session.qr_code.startsWith("data:") ? session.qr_code : `data:image/png;base64,${session.qr_code}`)
    : null;

  if (deleted) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-6 flex items-center justify-center">
        <p className="text-xs text-gray-600">Sessão excluída</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg flex flex-col">
      {/* ── Header ── */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {session.label ?? session.phone_number}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{session.phone_number}</p>
          {session.evolution_instance_name && (
            <p className="text-xs text-gray-700 mt-0.5">{session.evolution_instance_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
          <span className={`text-xs ${cfg.text}`}>{cfg.label}</span>
          {session.status === "disconnected" && session.evolution_instance_name && (
            <button onClick={handleConnect} disabled={actionLoading}
              className="text-xs px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded-md disabled:opacity-50 transition-colors">
              Conectar
            </button>
          )}
          {session.status === "connected" && (
            <button onClick={handleDisconnect} disabled={actionLoading}
              className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-md disabled:opacity-50 transition-colors">
              Desconectar
            </button>
          )}
        </div>
      </div>

      {session.last_seen_at && (
        <p className="px-4 pb-2 text-xs text-gray-700">
          Visto: {new Date(session.last_seen_at).toLocaleString("pt-BR")}
        </p>
      )}

      {/* ── QR Code ── */}
      {showQr && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-yellow-400 animate-pulse">Escaneie o QR Code com o WhatsApp</p>
          <div className="flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc!} alt="QR Code WhatsApp"
              className="w-40 h-40 rounded border border-gray-700 bg-white p-2 shrink-0" />
            <div className="pt-1 space-y-2">
              <p className="text-xs text-gray-400 leading-relaxed">
                Abra o WhatsApp no celular, vá em <strong className="text-gray-300">Dispositivos conectados</strong> e escaneie o código.
              </p>
              <button onClick={handleRefreshQr} disabled={actionLoading}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-yellow-800 hover:bg-yellow-700 text-yellow-200 rounded-md disabled:opacity-50 transition-colors">
                <RefreshCw size={11} />
                {actionLoading ? "Atualizando..." : "Atualizar QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {session.status === "connecting" && !session.qr_code && (
        <div className="px-4 pb-3 flex items-center gap-3">
          <p className="text-xs text-yellow-400 animate-pulse">Aguardando QR Code...</p>
          <button onClick={handleRefreshQr} disabled={actionLoading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-yellow-800 hover:bg-yellow-700 text-yellow-200 rounded-md disabled:opacity-50 transition-colors">
            <RefreshCw size={11} />
            {actionLoading ? "..." : "Buscar QR"}
          </button>
        </div>
      )}

      {/* ── Webhook (colapsável) ── */}
      <div className="border-t border-gray-800">
        <button
          onClick={() => setWebhookOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
          aria-expanded={webhookOpen}
        >
          <span className="font-medium">Configuração do Webhook</span>
          <ChevronDown size={14} className={`transition-transform ${webhookOpen ? "rotate-180" : ""}`} />
        </button>

        {webhookOpen && (
          <div className="px-4 pb-4 space-y-3">
            {/* URL */}
            <div className="space-y-1">
              <p className="text-xs text-gray-600">URL</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono truncate flex-1 bg-gray-800 px-2 py-1.5 rounded">
                  {webhookUrl}
                </span>
                <button
                  onClick={() => copyToClipboard(webhookUrl, "url")}
                  className="shrink-0 flex items-center gap-1 text-xs px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                  aria-label="Copiar URL do webhook"
                >
                  <Copy size={11} />
                  {copied === "url" ? "Copiado!" : "Copiar"}
                </button>
              </div>
            </div>

            {/* Secret */}
            {maskedSecret && (
              <div className="space-y-1">
                <p className="text-xs text-gray-600">Secret</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono flex-1 bg-gray-800 px-2 py-1.5 rounded">
                    {revealedSecret ?? maskedSecret}
                  </span>
                  {revealedSecret && (
                    <button
                      onClick={() => copyToClipboard(revealedSecret, "secret")}
                      className="shrink-0 flex items-center gap-1 text-xs px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                      aria-label="Copiar secret"
                    >
                      <Copy size={11} />
                      {copied === "secret" ? "Copiado!" : "Copiar"}
                    </button>
                  )}
                </div>
                {revealedSecret && (
                  <p className="text-xs text-yellow-600">Salve agora — será ocultado em 10 segundos.</p>
                )}
              </div>
            )}

            <button
              onClick={handleRotateSecret}
              disabled={rotateLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={11} />
              {rotateLoading ? "Regenerando..." : "Regenerar Secret"}
            </button>
          </div>
        )}
      </div>

      {/* ── Zona de perigo ── */}
      <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-gray-700">Zona de perigo</p>
        <div className="flex items-center gap-2">
          {deleteConfirm && (
            <span className="text-xs text-red-400">Tem certeza?</span>
          )}
          {deleteConfirm && (
            <button
              onClick={() => setDeleteConfirm(false)}
              className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
            >
              Cancelar
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            className={`text-xs px-2.5 py-1 rounded-md disabled:opacity-50 transition-colors ${
              deleteConfirm
                ? "bg-red-700 hover:bg-red-600 text-white"
                : "bg-transparent border border-red-800 text-red-500 hover:bg-red-900/30"
            }`}
          >
            {deleteLoading ? "Excluindo..." : deleteConfirm ? "Confirmar exclusão" : "Excluir sessão"}
          </button>
        </div>
      </div>
    </div>
  );
}
