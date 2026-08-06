"use client";

import Papa from "papaparse";
import { formatPhone } from "@/lib/chat-display";

interface OptOut {
  id: string;
  phone_e164: string;
  reason: string | null;
  created_at: string;
}

export default function OptOutsList({ optOuts }: { optOuts: OptOut[] }) {
  function handleExport() {
    const csv = Papa.unparse(
      optOuts.map((o) => ({
        phone: o.phone_e164,
        reason: o.reason ?? "",
        created_at: o.created_at,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opt-outs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (optOuts.length === 0) {
    return <p className="text-sm text-gray-500">Nenhum opt-out registrado ainda.</p>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{optOuts.length} contato(s) pediram para não receber mais campanhas.</p>
        <button onClick={handleExport} className="text-xs text-green-400 hover:text-green-300">
          Exportar CSV
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto border border-gray-800 rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-gray-800 text-gray-400 sticky top-0">
            <tr>
              <th className="text-left px-2 py-1.5">Telefone</th>
              <th className="text-left px-2 py-1.5">Motivo</th>
              <th className="text-left px-2 py-1.5">Data</th>
            </tr>
          </thead>
          <tbody>
            {optOuts.map((o) => (
              <tr key={o.id} className="border-t border-gray-800 text-gray-300">
                <td className="px-2 py-1.5">{formatPhone(o.phone_e164)}</td>
                <td className="px-2 py-1.5 text-gray-500">{o.reason ?? "—"}</td>
                <td className="px-2 py-1.5 text-gray-500">{new Date(o.created_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
