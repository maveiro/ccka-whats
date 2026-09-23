"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Toaster } from "sonner";
import Sidebar from "@/components/sidebar";
import AlertNotifier from "@/components/alert-notifier";
import { useIsLightTheme } from "@/lib/use-theme";

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
  // Sonner não lê a classe .light sozinho — precisa do tema via prop.
  const isLight = useIsLightTheme();

  return (
    <div className="flex h-screen bg-gray-950 light:bg-white text-white light:text-gray-900 overflow-hidden">
      {/* Barra superior mobile — some em md+, onde a Sidebar já é visível */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 border-b border-gray-800 light:border-gray-200 bg-gray-950 light:bg-white flex items-center px-3 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="text-gray-400 hover:text-white hover:bg-gray-900 light:text-gray-600 light:hover:text-gray-900 light:hover:bg-gray-100 transition-colors p-2 -ml-2 rounded-md"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold text-green-400 light:text-green-700">WA Intelligence</span>
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
      <Toaster position="top-right" theme={isLight ? "light" : "dark"} richColors />
      <AlertNotifier />
    </div>
  );
}
