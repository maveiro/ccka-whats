"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

interface Campaign {
  id: string;
  name: string;
  template_name: string;
  template_category: string | null;
  status: string;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  ready: "Pronta",
  sending: "Enviando",
  paused: "Pausada (limite atingido)",
  completed: "Concluída",
  failed: "Falhou",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "text-gray-400 border-gray-700",
  ready: "text-blue-400 border-blue-800",
  sending: "text-yellow-400 border-yellow-800",
  paused: "text-orange-400 border-orange-800",
  completed: "text-green-400 border-green-800",
  failed: "text-red-400 border-red-800",
};

export default function CampaignsList({ initial }: { initial: Campaign[] }) {
  const [campaigns, setCampaigns] = useState(initial);
  const [reportLoading, setReportLoading] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActive = campaigns.some((c) => c.status === "sending");

  useEffect(() => {
    if (!hasActive) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      const res = await fetch("/api/campaigns");
      if (!res.ok) return;
      setCampaigns(await res.json());
    }, 4000);

    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [hasActive]);

  async function handleFire(id: string) {
    const res = await fetch(`/api/campaigns/${id}/fire`, { method: "POST" });
    if (res.ok) {
      const refreshed = await fetch("/api/campaigns");
      if (refreshed.ok) setCampaigns(await refreshed.json());
    }
  }

  async function handleReport(campaign: Campaign) {
    setReportLoading(campaign.id);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/recipients`);
      if (!res.ok) return;
      const rows = await res.json() as Record<string, unknown>[];
      const csv = Papa.unparse(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${campaign.name.replace(/[^a-z0-9]+/gi, "-")}-relatorio.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setReportLoading(null);
    }
  }

  async function handleDelete(id: string) {
    if (deleteConfirm !== id) { setDeleteConfirm(id); return; }
    setDeleteLoading(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCampaigns((prev) => prev.filter((c) => c.id !== id));
      } else {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        alert(data?.error ?? "Não foi possível excluir a campanha");
      }
    } finally {
      setDeleteLoading(null);
      setDeleteConfirm(null);
    }
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-gray-500">Nenhuma campanha criada ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {campaigns.map((c) => (
        <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{c.name}</p>
              <p className="text-xs text-gray-500">
                {c.template_name} {c.template_category ? `· ${c.template_category}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded border ${STATUS_COLOR[c.status] ?? "text-gray-400 border-gray-700"}`}>
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
              {c.status === "ready" && (
                <button
                  onClick={() => handleFire(c.id)}
                  className="text-xs px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors"
                >
                  Disparar
                </button>
              )}
              {c.total_recipients > 0 && (
                <button
                  onClick={() => handleReport(c)}
                  disabled={reportLoading === c.id}
                  className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md disabled:opacity-50 transition-colors"
                >
                  {reportLoading === c.id ? "Gerando..." : "Relatório"}
                </button>
              )}
              {["draft", "ready"].includes(c.status) && (
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={deleteLoading === c.id}
                  className={`text-xs px-2.5 py-1 rounded-md disabled:opacity-50 transition-colors ${
                    deleteConfirm === c.id
                      ? "bg-red-700 hover:bg-red-600 text-white"
                      : "bg-transparent border border-red-800 text-red-500 hover:bg-red-900/30"
                  }`}
                >
                  {deleteLoading === c.id ? "Excluindo..." : deleteConfirm === c.id ? "Confirmar?" : "Excluir"}
                </button>
              )}
            </div>
          </div>

          {c.total_recipients > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{c.sent_count + c.failed_count}/{c.total_recipients} processados</span>
                <span>{c.delivered_count} entregues · {c.read_count} lidos · {c.failed_count} falhas</span>
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-600 transition-all"
                  style={{ width: `${Math.min(100, ((c.sent_count + c.failed_count) / c.total_recipients) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
