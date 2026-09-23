"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/button";
import StatusDot from "@/components/ui/status-dot";

interface Session {
  id: string;
  phone_number: string;
  label: string | null;
  status: string;
  last_seen_at: string | null;
  evolution_instance_name: string | null;
  qr_code: string | null;
  webhook_secret: string | null;
  channel?: string; // "evolution" | "cloud_api" — ausente em sessões antigas, trata como evolution
}

const statusConfig: Record<string, { tone: "green" | "gray" | "yellow" | "red"; label: string }> = {
  connected:    { tone: "green",  label: "Conectado" },
  disconnected: { tone: "gray",   label: "Desconectado" },
  connecting:   { tone: "yellow", label: "Conectando" },
  banned:       { tone: "red",    label: "Banido" },
};

export default function SessionCard({ session: initial, isAdmin = true }: { session: Session; isAdmin?: boolean }) {
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

  const isCloudApi = session.channel === "cloud_api";
  const cfg = statusConfig[session.status] ?? statusConfig.disconnected;
  const maskedSecret = session.webhook_secret ? `${session.webhook_secret.slice(0, 8)}...` : null;
  const showQr = session.status === "connecting" && session.qr_code;
  const qrSrc = session.qr_code
    ? (session.qr_code.startsWith("data:") ? session.qr_code : `data:image/png;base64,${session.qr_code}`)
    : null;

  if (deleted) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-6 flex items-center justify-center">
        <p className="text-xs text-gray-400">Sessão excluída</p>
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
            <p className="text-xs text-gray-500 mt-0.5">{session.evolution_instance_name}</p>
          )}
          {isCloudApi && (
            <p className="text-xs text-blue-400 mt-0.5">WhatsApp Cloud API (oficial)</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusDot tone={cfg.tone} label={cfg.label} />
          {session.status === "disconnected" && session.evolution_instance_name && (
            <Button variant="primary" onClick={handleConnect} disabled={actionLoading}>
              Conectar
            </Button>
          )}
          {session.status === "connected" && (
            <Button variant="secondary" onClick={handleDisconnect} disabled={actionLoading}>
              Desconectar
            </Button>
          )}
        </div>
      </div>

      {session.last_seen_at && (
        <p className="px-4 pb-2 text-xs text-gray-500">
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
              <Button variant="warning" onClick={handleRefreshQr} disabled={actionLoading}>
                <RefreshCw size={11} />
                {actionLoading ? "Atualizando..." : "Atualizar QR"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {session.status === "connecting" && !session.qr_code && (
        <div className="px-4 pb-3 flex items-center gap-3">
          <p className="text-xs text-yellow-400 animate-pulse">Aguardando QR Code...</p>
          <Button variant="warning" onClick={handleRefreshQr} disabled={actionLoading}>
            <RefreshCw size={11} />
            {actionLoading ? "..." : "Buscar QR"}
          </Button>
        </div>
      )}

      {/* ── Webhook (colapsável, só admin) — só faz sentido pra Evolution;
          Cloud API usa webhook do Meta App, configurado fora daqui ── */}
      {isAdmin && !isCloudApi && (
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
              <p className="text-xs text-gray-500">URL</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono truncate flex-1 bg-gray-800 px-2 py-1.5 rounded">
                  {webhookUrl}
                </span>
                <Button
                  onClick={() => copyToClipboard(webhookUrl, "url")}
                  aria-label="Copiar URL do webhook"
                >
                  <Copy size={11} />
                  {copied === "url" ? "Copiado!" : "Copiar"}
                </Button>
              </div>
            </div>

            {/* Secret */}
            {maskedSecret && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Secret</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono flex-1 bg-gray-800 px-2 py-1.5 rounded">
                    {revealedSecret ?? maskedSecret}
                  </span>
                  {revealedSecret && (
                    <Button
                      onClick={() => copyToClipboard(revealedSecret, "secret")}
                      aria-label="Copiar secret"
                    >
                      <Copy size={11} />
                      {copied === "secret" ? "Copiado!" : "Copiar"}
                    </Button>
                  )}
                </div>
                {revealedSecret && (
                  <p className="text-xs text-yellow-600">Salve agora — será ocultado em 10 segundos.</p>
                )}
              </div>
            )}

            <Button variant="secondary" onClick={handleRotateSecret} disabled={rotateLoading}>
              <RefreshCw size={11} />
              {rotateLoading ? "Regenerando..." : "Regenerar Secret"}
            </Button>
          </div>
        )}
      </div>
      )}

      {/* ── Zona de perigo (só admin) ── */}
      {isAdmin && (
      <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">Zona de perigo</p>
        <div className="flex items-center gap-2">
          {deleteConfirm && (
            <span className="text-xs text-red-400">Tem certeza?</span>
          )}
          {deleteConfirm && (
            <Button variant="secondary" onClick={() => setDeleteConfirm(false)}>
              Cancelar
            </Button>
          )}
          <Button
            variant={deleteConfirm ? "danger" : "dangerOutline"}
            onClick={handleDelete}
            disabled={deleteLoading}
          >
            {deleteLoading ? "Excluindo..." : deleteConfirm ? "Confirmar exclusão" : "Excluir sessão"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
