import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HistorySyncForm from "./history-sync-form";

export default async function HistoryPage() {
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
    .select("id, label, phone_number, evolution_instance_name")
    .not("evolution_instance_name", "is", null)
    .order("created_at");

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Importar Histórico</h1>
        <p className="text-sm text-gray-400 mt-1">
          Importa mensagens antigas do WhatsApp para o banco. Só precisa ser feito uma vez por número.
        </p>
      </div>
      <HistorySyncForm sessions={sessions ?? []} />
    </div>
  );
}
