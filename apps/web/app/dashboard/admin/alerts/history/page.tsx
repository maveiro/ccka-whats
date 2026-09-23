import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import AlertHistoryClient from "./alert-history-client";

export default async function AlertHistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const admin = createAdminClient();

  const { data: initialEvents, count: total } = await admin
    .from("alert_events")
    .select(
      "id, matched_keyword, seen, created_at, alert_id, alerts(name), messages(id, chat_id, body, type, timestamp)",
      { count: "exact" },
    )
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: false })
    .range(0, 19);

  return (
    <div className="p-6 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center gap-3">
        <a href="/dashboard/admin/alerts" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Alertas
        </a>
        <h1 className="text-lg font-semibold text-white">Histórico de alertas</h1>
        {(total ?? 0) > 0 && (
          <span className="text-xs text-gray-400">{total} evento{total !== 1 ? "s" : ""}</span>
        )}
      </div>
      <AlertHistoryClient
        initialEvents={(initialEvents ?? []) as unknown as Parameters<typeof AlertHistoryClient>[0]["initialEvents"]}
        total={total ?? 0}
      />
    </div>
  );
}
