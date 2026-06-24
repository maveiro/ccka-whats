import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SessionCard from "@/components/session-card";

export default async function SessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: sessions } = await supabase
    .from("wa_sessions")
    .select("id, phone_number, label, status, last_seen_at, evolution_instance_name, qr_code, webhook_secret")
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-lg font-semibold text-white">Sessões WhatsApp</h1>
      <div className="grid grid-cols-1 gap-4 max-w-2xl">
        {(sessions ?? []).map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}
