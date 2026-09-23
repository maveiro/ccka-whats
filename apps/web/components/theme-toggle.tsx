"use client";

import { Sun, Moon } from "lucide-react";
import { useIsLightTheme } from "@/lib/use-theme";

const THEME_KEY = "wa-theme";

// Escuro é o padrão (histórico); "light" é a única preferência persistida —
// ausência da chave sempre significa escuro, então nunca gravamos "dark".
export default function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const isLight = useIsLightTheme();

  function toggle() {
    const next = !isLight;
    document.documentElement.classList.toggle("light", next);
    try {
      if (next) localStorage.setItem(THEME_KEY, "light");
      else localStorage.removeItem(THEME_KEY);
    } catch { /* localStorage indisponível — tema só não persiste */ }
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center min-h-[36px] rounded-md text-sm transition-colors text-gray-400 hover:bg-gray-900 hover:text-white light:text-gray-500 light:hover:bg-gray-100 light:hover:text-gray-900 ${
        collapsed ? "justify-center px-0 w-full" : "gap-2.5 px-3"
      }`}
      aria-label={isLight ? "Mudar para tema escuro" : "Mudar para tema claro"}
      title={isLight ? "Tema escuro" : "Tema claro"}
    >
      {isLight ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
      {!collapsed && <span>{isLight ? "Tema escuro" : "Tema claro"}</span>}
    </button>
  );
}
