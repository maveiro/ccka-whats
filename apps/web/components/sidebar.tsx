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
  Megaphone,
  Activity,
  BookOpen,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Workflow,
  Hash,
  CalendarDays,
  ShieldCheck,
  Link2,
  HelpCircle,
  ClipboardList,
  DollarSign,
  FileText,
  X,
} from "lucide-react";
import AlertBadge from "@/components/alert-badge";
import ThemeToggle from "@/components/theme-toggle";

const COLLAPSE_KEY = "wa-sidebar-collapsed";

interface SidebarProps {
  operatorName: string;
  role: string;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

// Agrupado por domínio, não pela ordem em que cada módulo foi implementado
// (achado na revisão de UX de 22/09/2026: 18 itens administrativos num bloco
// só, sem refletir os módulos aditivos descritos no CLAUDE.md — mensagens,
// campanhas, central/automação e governança). Cabeçalho novo entra sempre que
// a `group` muda; "main" não ganha cabeçalho, fica solto no topo.
const SECTION_LABELS: Record<string, string> = {
  mensagens: "Mensagens",
  campanhas: "Campanhas",
  central: "Central & Automação",
  governanca: "Governança",
  conta: "Conta",
};

const navItems = [
  { label: "Mensagens",     href: "/dashboard",                      roles: ["admin", "operator"], icon: MessageSquare, section: "main" },
  { label: "Analytics",     href: "/dashboard/analytics",            roles: ["admin", "operator"], icon: BarChart2,     section: "main" },

  { label: "Sessões",       href: "/dashboard/admin/sessions",       roles: ["admin", "operator"], icon: Smartphone,   section: "mensagens", showStatus: true },
  { label: "Operadores",    href: "/dashboard/admin/operators",      roles: ["admin"],             icon: Users,        section: "mensagens" },
  { label: "Alertas",       href: "/dashboard/admin/alerts",         roles: ["admin"],             icon: Bell,         section: "mensagens", showAlertBadge: true },
  { label: "Histórico",     href: "/dashboard/admin/history",        roles: ["admin"],             icon: History,      section: "mensagens" },

  { label: "Campanhas",     href: "/dashboard/admin/campaigns",      roles: ["admin"],             icon: Megaphone,    section: "campanhas" },
  { label: "Templates",     href: "/dashboard/admin/templates",      roles: ["admin"],             icon: FileText,     section: "campanhas" },
  { label: "Custos",        href: "/dashboard/admin/costs",          roles: ["admin"],             icon: DollarSign,   section: "campanhas" },
  { label: "Números",       href: "/dashboard/admin/numbers",        roles: ["admin"],             icon: Hash,         section: "campanhas" },

  { label: "Automações",    href: "/dashboard/admin/flows",          roles: ["admin", "operator"], icon: Workflow,     section: "central" },
  { label: "Agenda",        href: "/dashboard/admin/agenda",         roles: ["admin", "operator"], icon: CalendarDays, section: "central" },
  { label: "FAQ",           href: "/dashboard/admin/faq",            roles: ["admin", "operator"], icon: HelpCircle,   section: "central" },
  { label: "Páginas",       href: "/dashboard/admin/paginas",        roles: ["admin", "operator"], icon: Link2,        section: "central" },
  { label: "Formulários",   href: "/dashboard/admin/formularios",    roles: ["admin"],             icon: ClipboardList, section: "central" },

  { label: "Clientes (LGPD)", href: "/dashboard/admin/clientes",     roles: ["admin"],             icon: ShieldCheck,  section: "governanca" },
  { label: "Integrações",   href: "/dashboard/admin/integrations",   roles: ["admin"],             icon: Plug,         section: "governanca" },
  { label: "Saúde",         href: "/dashboard/admin/saude",          roles: ["admin"],             icon: Activity,     section: "governanca" },
  { label: "Aprendizados",  href: "/dashboard/admin/aprendizados",   roles: ["admin"],             icon: BookOpen,     section: "governanca" },

  { label: "Configurações", href: "/dashboard/settings",             roles: ["admin"],             icon: Settings,     section: "conta" },
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

export default function Sidebar({ operatorName, role, mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleItems = navItems.filter((item) => item.roles.includes(role));
  // No drawer mobile, o collapse por ícone (preferência de desktop, persistida
  // à parte) não se aplica — a gaveta sempre abre larga.
  const iconOnly = collapsed && !mobileOpen;

  return (
    <aside
      className={`${iconOnly ? "w-16" : "w-56"} flex flex-col border-r border-gray-800 light:border-gray-200 bg-gray-950 light:bg-white shrink-0 transition-all duration-200 fixed inset-y-0 left-0 z-50 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:static md:translate-x-0`}
    >
      {/* Logo + toggle */}
      <div className={`h-[57px] border-b border-gray-800 light:border-gray-200 flex items-center ${iconOnly ? "justify-center" : "justify-between px-4"}`}>
        {!iconOnly && <span className="text-sm font-semibold text-green-400 light:text-green-700 truncate">WA Intelligence</span>}
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="hidden md:inline-flex text-gray-400 hover:text-white hover:bg-gray-900 light:text-gray-600 light:hover:text-gray-900 light:hover:bg-gray-100 transition-colors p-1.5 rounded-md"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            onClick={onCloseMobile}
            className="md:hidden text-gray-400 hover:text-white hover:bg-gray-900 light:text-gray-600 light:hover:text-gray-900 light:hover:bg-gray-100 transition-colors p-1.5 rounded-md"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden" aria-label="Navegação principal">
        {visibleItems.map((item, idx) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const isNewSection =
            item.section !== "main" &&
            (idx === 0 || visibleItems[idx - 1].section !== item.section);
          const showStatus = item.showStatus && role === "admin";
          const showAlert = item.showAlertBadge && role === "admin";

          return (
            <div key={item.href}>
              {isNewSection && (
                iconOnly ? (
                  <div className="my-2 mx-2 border-t border-gray-800 light:border-gray-200" />
                ) : (
                  <div className="px-3 pt-4 pb-1">
                    <p className="text-xs font-medium text-gray-400 light:text-gray-600 uppercase tracking-widest">
                      {SECTION_LABELS[item.section] ?? item.section}
                    </p>
                  </div>
                )
              )}
              <Link
                href={item.href}
                title={iconOnly ? item.label : undefined}
                onClick={onCloseMobile}
                className={`flex items-center min-h-[44px] rounded-md text-sm transition-colors ${
                  iconOnly ? "justify-center px-0" : "gap-2.5 px-3"
                } ${
                  active
                    ? "bg-gray-800 text-white light:bg-gray-100 light:text-gray-900"
                    : "text-gray-400 hover:bg-gray-900 hover:text-white light:text-gray-600 light:hover:bg-gray-100 light:hover:text-gray-900"
                }`}
              >
                <span className="relative shrink-0 flex items-center justify-center">
                  <Icon size={16} className={active ? "text-green-400 light:text-green-700" : ""} aria-hidden="true" />
                  {iconOnly && (showStatus || showAlert) && (
                    <span className="absolute -top-1.5 -right-1.5">
                      {showStatus && <SessionStatusDot />}
                      {showAlert && <AlertBadge />}
                    </span>
                  )}
                </span>
                {!iconOnly && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {showStatus && <SessionStatusDot />}
                    {showAlert && <AlertBadge />}
                  </>
                )}
              </Link>
            </div>
          );
        })}
        <div className={`mt-2 pt-2 border-t border-gray-800 light:border-gray-200 ${iconOnly ? "px-0" : "px-1"}`}>
          <ThemeToggle collapsed={iconOnly} />
        </div>
      </nav>

      {/* Operator footer */}
      <div className={`py-3 border-t border-gray-800 light:border-gray-200 ${iconOnly ? "px-2" : "px-3"}`}>
        <div className={`flex items-center ${iconOnly ? "flex-col gap-2" : "gap-2.5"}`}>
          <OperatorAvatar name={operatorName} />
          {!iconOnly && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white light:text-gray-900 truncate">{operatorName}</p>
              <p className="text-xs text-gray-400 light:text-gray-600 capitalize">{role}</p>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="shrink-0 text-gray-400 hover:text-white hover:bg-gray-900 light:text-gray-600 light:hover:text-gray-900 light:hover:bg-gray-100 transition-colors p-2 rounded-md flex items-center justify-center"
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
