import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SessionCard from "@/components/session-card";
import SessionsPageHeader from "@/components/sessions-page-header";

export default async function SessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin" && operator?.role !== "operator") redirect("/dashboard");

  const isAdmin = operator.role === "admin";

  const { data: sessions } = await supabase
    .from("wa_sessions")
    .select("id, phone_number, label, status, last_seen_at, evolution_instance_name, qr_code, webhook_secret")
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 space-y-6">
      <SessionsPageHeader />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {(sessions ?? []).map((session) => (
          <SessionCard
            key={session.id}
            // webhook_secret nunca chega ao client de um operador — não é só esconder
            // na UI, o dado não deve nem sair do server component nesse caso.
            session={{ ...session, webhook_secret: isAdmin ? session.webhook_secret : null }}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </div>
  );
}
