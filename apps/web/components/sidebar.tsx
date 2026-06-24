"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface SidebarProps {
  operatorName: string;
  role: string;
}

const navItems = [
  { label: "Mensagens", href: "/dashboard", roles: ["admin", "operator"] },
  { label: "Sessões", href: "/dashboard/admin/sessions", roles: ["admin"] },
  { label: "Operadores", href: "/dashboard/admin/operators", roles: ["admin"] },
  { label: "Integrações", href: "/dashboard/admin/integrations", roles: ["admin"] },
  { label: "Histórico", href: "/dashboard/admin/history", roles: ["admin"] },
  { label: "Configurações", href: "/dashboard/settings", roles: ["admin"] },
];

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
      <div className="px-4 py-5 border-b border-gray-800">
        <span className="text-sm font-semibold text-green-400">WA Intelligence</span>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {visibleItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-900 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-500 truncate mb-2">{operatorName}</p>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-500 hover:text-white transition-colors"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
