import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Exclusão restrita a draft/ready — uma campanha que já começou a enviar
// (sending/paused/completed/failed) tem que preservar o histórico de
// disparo (regra de auditoria do módulo, ver events_log/campaign_recipients).
// campaign_recipients é apagado em cascade (FK on delete cascade,
// migration 0019) junto com a campanha.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, tenant_id, status")
    .eq("id", id)
    .single();

  if (!campaign || campaign.tenant_id !== operator.tenant_id) {
    return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  }
  if (!["draft", "ready"].includes(campaign.status)) {
    return NextResponse.json(
      { error: "Só é possível excluir campanhas em rascunho ou prontas (ainda não disparadas) — preserva o histórico de envio" },
      { status: 409 },
    );
  }

  const { error } = await admin.from("campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "campaign_deleted",
    payload: { campaignId: id, status: campaign.status },
  });

  return NextResponse.json({ ok: true });
}
