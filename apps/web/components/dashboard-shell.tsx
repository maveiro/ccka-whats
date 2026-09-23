"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Toaster } from "sonner";
import Sidebar from "@/components/sidebar";
import AlertNotifier from "@/components/alert-notifier";

// Sidebar era fixa e sempre visível — sem tratamento nenhum pra tela estreita
// (achado na revisão de UX de 22/09/2026: só 6/74 arquivos usavam algum
// breakpoint). Abaixo de md, a sidebar vira drawer: fora da tela por padrão,
// acionada por esta barra superior. Em md+ o comportamento de sempre
// continua (Sidebar cuida do próprio collapse por ícone).
export default function DashboardShell({
  operatorName,
  role,
  children,
}: {
  operatorName: string;
  role: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Barra superior mobile — some em md+, onde a Sidebar já é visível */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 border-b border-gray-800 bg-gray-950 flex items-center px-3 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="text-gray-400 hover:text-white transition-colors p-2 -ml-2 rounded-md hover:bg-gray-900"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold text-green-400">WA Intelligence</span>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        operatorName={operatorName}
        role={role}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* pt-14 compensa a barra mobile fixa; some em md+ */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</main>
      <Toaster position="top-right" theme="dark" richColors />
      <AlertNotifier />
    </div>
  );
}
