"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Sem isso, um erro de runtime em qualquer tela admin cai na tela de erro
// genérica do Next — sem contexto e sem saída. Fica só aqui (app/dashboard),
// não na raiz: /login, /a/, /f/ etc têm o próprio risco e não devem herdar
// texto pensado para quem já está autenticado no painel.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-900/40 text-red-400">
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white light:text-gray-900">Algo deu errado nesta tela</p>
          <p className="mt-1 text-xs text-gray-400 light:text-gray-600">
            O erro foi registrado. Você pode tentar de novo ou checar a página de Saúde
            para ver se é um problema conhecido.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-gray-400 font-mono light:text-gray-600">ref: {error.digest}</p>
          )}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors light:bg-gray-200 light:text-gray-900"
          >
            Tentar de novo
          </button>
          <Link
            href="/dashboard/admin/saude"
            className="text-xs px-3 py-1.5 border border-gray-700 hover:bg-gray-800 text-gray-300 rounded-md transition-colors light:border-gray-300 light:hover:bg-gray-100 light:text-gray-700"
          >
            Ver Saúde
          </Link>
        </div>
      </div>
    </div>
  );
}
