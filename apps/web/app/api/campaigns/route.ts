import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

interface RecipientInput {
  phone: string;
  variables?: Record<string, unknown>;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, template_name, template_category, status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    campaignId?: unknown; // se presente: adiciona/atualiza destinatários numa campanha draft existente
    name?: unknown;
    credentialId?: unknown;
    templateName?: unknown;
    templateLanguage?: unknown;
    templateCategory?: unknown;
    templateComponents?: unknown;
    recipients?: unknown;
  };

  const recipientsInput = Array.isArray(body.recipients) ? (body.recipients as RecipientInput[]) : [];
  const validRecipients = recipientsInput.filter(
    (r) => r && typeof r.phone === "string" && /^\d{10,15}$/.test(r.phone),
  );

  if (validRecipients.length === 0) {
    return NextResponse.json({ error: "Nenhum destinatário válido (telefone em E.164 sem '+', ex: 5541999999999)" }, { status: 400 });
  }

  const admin = createAdminClient();
  let campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

  if (!campaignId) {
    if (
      typeof body.name !== "string" || !body.name.trim() ||
      typeof body.credentialId !== "string" ||
      typeof body.templateName !== "string" ||
      typeof body.templateLanguage !== "string"
    ) {
      return NextResponse.json({ error: "name, credentialId, templateName e templateLanguage são obrigatórios" }, { status: 400 });
    }

    const { data: newCampaign, error: createError } = await admin
      .from("campaigns")
      .insert({
        tenant_id: operator.tenant_id,
        credential_id: body.credentialId,
        created_by: user.id,
        name: body.name.trim(),
        template_name: body.templateName,
        template_language: body.templateLanguage,
        template_category: typeof body.templateCategory === "string" ? body.templateCategory : null,
        template_components: body.templateComponents ?? null,
        status: "draft",
      })
      .select("id")
      .single();

    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
    campaignId = newCampaign.id;

    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "campaign_created",
      payload: { campaignId, templateName: body.templateName },
    });
  } else {
    // Confirmar que a campanha pertence ao tenant e ainda está em draft
    // (não permitir reupload de base depois que já começou a enviar).
    const { data: existing } = await admin
      .from("campaigns")
      .select("id, tenant_id, status")
      .eq("id", campaignId)
      .single();

    if (!existing || existing.tenant_id !== operator.tenant_id) {
      return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "Só é possível adicionar destinatários a campanhas em rascunho" }, { status: 409 });
    }
  }

  // Filtrar opt-outs antes de inserir.
  const { data: optOuts } = await admin
    .from("whatsapp_opt_outs")
    .select("phone_e164")
    .eq("tenant_id", operator.tenant_id)
    .in("phone_e164", validRecipients.map((r) => r.phone));

  const optOutSet = new Set((optOuts ?? []).map((o) => o.phone_e164));
  const filteredRecipients = validRecipients.filter((r) => !optOutSet.has(r.phone));

  // Upsert que NUNCA toca status/wamid/attempts/sent_at no conflito — reupload
  // de CSV não pode voltar quem já foi sent/delivered para pending.
  const rows = filteredRecipients.map((r) => ({
    campaign_id: campaignId,
    tenant_id: operator.tenant_id,
    phone_e164: r.phone,
    variables: r.variables ?? {},
  }));

  const { error: upsertError } = await admin
    .from("campaign_recipients")
    .upsert(rows, { onConflict: "campaign_id,phone_e164", ignoreDuplicates: false })
    .select("id");

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  const { count } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  await admin
    .from("campaigns")
    .update({ total_recipients: count ?? 0, status: "ready", updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "draft"); // não regride uma campanha que já não está mais em draft

  return NextResponse.json({
    campaignId,
    accepted: filteredRecipients.length,
    skippedOptOut: validRecipients.length - filteredRecipients.length,
    skippedInvalid: recipientsInput.length - validRecipients.length,
    total: count ?? 0,
  }, { status: 201 });
}
