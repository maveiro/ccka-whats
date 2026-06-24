"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  BarChart2,
  Smartphone,
  Users,
  Bell,
  Plug,
  History,
  Settings,
  LogOut,
} from "lucide-react";

interface SidebarProps {
  operatorName: string;
  role: string;
}

const navItems = [
  { label: "Mensagens",     href: "/dashboard",                      roles: ["admin", "operator"], icon: MessageSquare, section: "main" },
  { label: "Analytics",     href: "/dashboard/analytics",            roles: ["admin", "operator"], icon: BarChart2,     section: "main" },
  { label: "Sessões",       href: "/dashboard/admin/sessions",       roles: ["admin"],             icon: Smartphone,   section: "admin", showStatus: true },
  { label: "Operadores",    href: "/dashboard/admin/operators",      roles: ["admin"],             icon: Users,        section: "admin" },
  { label: "Alertas",       href: "/dashboard/admin/alerts",         roles: ["admin"],             icon: Bell,         section: "admin" },
  { label: "Integrações",   href: "/dashboard/admin/integrations",   roles: ["admin"],             icon: Plug,         section: "admin" },
  { label: "Histórico",     href: "/dashboard/admin/history",        roles: ["admin"],             icon: History,      section: "admin" },
  { label: "Configurações", href: "/dashboard/settings",             roles: ["admin"],             icon: Settings,     section: "admin" },
];

const AVATAR_COLORS = [
  "bg-violet-600",
  "bg-blue-600",
  "bg-teal-600",
  "bg-orange-500",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-amber-600",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function OperatorAvatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const color = avatarColor(name);
  return (
    <div
      className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-xs font-bold text-white shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function SessionStatusDot() {
  const [hasOffline, setHasOffline] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function refresh() {
      const { data } = await supabase.from("wa_sessions").select("status");
      if (!data || data.length === 0) { setHasOffline(false); return; }
      setHasOffline(data.some((s) => s.status !== "connected"));
    }

    void refresh();

    const channel = supabase
      .channel("sidebar-sessions-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_sessions" }, () => {
        void refresh();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (hasOffline === null) return null;

  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${hasOffline ? "bg-red-500" : "bg-green-500"}`}
      aria-label={hasOffline ? "Atenção: sessão desconectada" : "Todas as sessões conectadas"}
      title={hasOffline ? "Sessão desconectada" : "Conectado"}
    />
  );
}

export default function Sidebar({ operatorName, role }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleItems = navItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-56 flex flex-col border-r border-gray-800 bg-gray-950 shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800">
        <span className="text-sm font-semibold text-green-400">WA Intelligence</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto" aria-label="Navegação principal">
        {visibleItems.map((item, idx) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const isFirstAdmin =
            item.section === "admin" &&
            (idx === 0 || visibleItems[idx - 1].section !== "admin");

          return (
            <div key={item.href}>
              {isFirstAdmin && (
                <div className="px-3 pt-4 pb-1">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-widest">
                    Administração
                  </p>
                </div>
              )}
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 px-3 min-h-[44px] rounded-md text-sm transition-colors ${
                  active
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:bg-gray-900 hover:text-white"
                }`}
              >
                <Icon
                  size={16}
                  className={`shrink-0 ${active ? "text-green-400" : ""}`}
                  aria-hidden="true"
                />
                <span className="flex-1">{item.label}</span>
                {item.showStatus && role === "admin" && <SessionStatusDot />}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Operator footer */}
      <div className="px-3 py-3 border-t border-gray-800">
        <div className="flex items-center gap-2.5">
          <OperatorAvatar name={operatorName} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{operatorName}</p>
            <p className="text-xs text-gray-600 capitalize">{role}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 text-gray-500 hover:text-white transition-colors p-2 rounded-md hover:bg-gray-900 flex items-center justify-center"
            aria-label="Sair da conta"
            title="Sair"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
