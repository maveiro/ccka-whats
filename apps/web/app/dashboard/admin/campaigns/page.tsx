import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import CampaignWizard from "./campaign-wizard";
import CampaignsList from "./campaigns-list";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, template_name, template_category, status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: false });

  // whatsapp_cloud_credentials tem RLS deny-all (só service-role lê, de
  // propósito — guarda o access_token de disparo) — o client autenticado
  // normal sempre voltaria vazio aqui, mesmo com credencial salva.
  const admin = createAdminClient();
  const { data: credentials } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, waba_id, phone_number_id, display_phone_number, active")
    .eq("tenant_id", operator.tenant_id);

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Campanhas — WhatsApp Cloud API</h1>
        <p className="text-sm text-gray-400 mt-1">
          Disparo oficial via templates aprovados pela Meta. Módulo independente do
          pipeline de captura de mensagens (Evolution).
        </p>
      </div>

      <CampaignWizard credentials={credentials ?? []} />

      <div>
        <h2 className="text-sm font-semibold text-white mb-3">Campanhas</h2>
        <CampaignsList initial={campaigns ?? []} />
      </div>
    </div>
  );
}
