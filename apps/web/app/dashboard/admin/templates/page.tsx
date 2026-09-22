import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import TemplatesList from "./templates-list";
import { env } from "@/lib/env";

// Fase 1 do PRD (docs/prd/prd-criacao-de-templates.md): visibilidade do que
// já existe na Meta — status, categoria, motivo de rejeição — antes de
// existir formulário de criação. Admin-only, mesmo padrão de Campanhas.
export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  // whatsapp_cloud_credentials tem RLS deny-all — só o admin client lê
  // (guarda o access_token de disparo). Mesmo padrão de admin/campaigns.
  const admin = createAdminClient();
  const { data: credentials } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, waba_id, phone_number_id, display_phone_number, artista, active")
    .eq("tenant_id", operator.tenant_id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Templates — WhatsApp Cloud API</h1>
        <p className="text-sm text-gray-400 mt-1">
          Crie, submeta e acompanhe a revisão da Meta — por conta (WABA). Botão de URL
          rastreada já sai com a convenção certa; ver docs/prd/prd-criacao-de-templates.md.
        </p>
      </div>

      <TemplatesList credentials={credentials ?? []} linkBaseUrl={env.NEXT_PUBLIC_LINK_BASE_URL ?? null} />
    </div>
  );
}
