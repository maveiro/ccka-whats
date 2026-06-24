import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AlertsManager from "@/components/alerts-manager";

export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const [{ data: alerts }, { data: sessions }, { data: recentEvents }] = await Promise.all([
    supabase
      .from("alerts")
      .select("id, name, keywords, active, session_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("wa_sessions")
      .select("id, label")
      .order("created_at", { ascending: true }),
    supabase
      .from("alert_events")
      .select("id, matched_keyword, seen, created_at, alert_id, alerts(name), messages(body, type)")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-lg font-semibold text-white">Alertas</h1>
      <AlertsManager
        initialAlerts={alerts ?? []}
        sessions={sessions ?? []}
        recentEvents={(recentEvents ?? []) as unknown as Parameters<typeof AlertsManager>[0]["recentEvents"]}
      />
    </div>
  );
}
