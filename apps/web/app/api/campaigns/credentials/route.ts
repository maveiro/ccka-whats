import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Credenciais do Cloud API são admin-only e nunca retornam o access_token
// pro client depois de gravadas — mesma lógica de deny-all da tabela
// (whatsapp_cloud_credentials, migration 0019): a única leitura completa
// acontece em lib/whatsapp-cloud/getCloudCredential.ts, server-side.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, waba_id, phone_number_id, display_phone_number, active, created_at")
    .eq("tenant_id", operator.tenant_id);

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
    wabaId?: unknown;
    phoneNumberId?: unknown;
    displayPhoneNumber?: unknown;
    accessToken?: unknown;
  };
  const { wabaId, phoneNumberId, displayPhoneNumber, accessToken } = body;

  if (
    typeof wabaId !== "string" || !wabaId.trim() ||
    typeof phoneNumberId !== "string" || !phoneNumberId.trim() ||
    typeof accessToken !== "string" || !accessToken.trim()
  ) {
    return NextResponse.json({ error: "wabaId, phoneNumberId e accessToken são obrigatórios" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .upsert({
      tenant_id: operator.tenant_id,
      waba_id: wabaId.trim(),
      phone_number_id: phoneNumberId.trim(),
      display_phone_number: typeof displayPhoneNumber === "string" ? displayPhoneNumber.trim() : null,
      access_token: accessToken.trim(),
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,phone_number_id" })
    .select("id, waba_id, phone_number_id, display_phone_number, active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "cloud_credential_saved",
    payload: { credentialId: data.id, phoneNumberId: phoneNumberId.trim() },
  });

  return NextResponse.json(data, { status: 201 });
}
