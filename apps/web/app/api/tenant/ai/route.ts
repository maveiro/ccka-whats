import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateOpenAIKey, mask } from "@/lib/ai";

// POST /api/tenant/ai — salvar/atualizar a chave OpenAI do tenant (BYOK)
// body: { apiKey: string }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return NextResponse.json({ error: "Chave obrigatória" }, { status: 400 });

  // Validar a chave antes de persistir
  const validation = await validateOpenAIKey(apiKey);
  if (!validation.ok) {
    return NextResponse.json({ error: "Chave inválida", reason: validation.reason }, { status: 400 });
  }

  const admin = createAdminClient();
  const tenantId = me.tenant_id as string;

  // Upsert in-place da integração openai ativa do tenant
  const { data: existing } = await admin
    .from("integrations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("type", "openai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("integrations")
      .update({ config: { api_key: apiKey }, active: true })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin
      .from("integrations")
      .insert({ tenant_id: tenantId, type: "openai", label: "OpenAI", config: { api_key: apiKey }, active: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // events_log — nunca a chave, só os últimos 4
  await admin.from("events_log").insert({
    tenant_id: tenantId,
    session_id: null,
    event_type: "integration_updated",
    payload: { type: "openai", last4: apiKey.slice(-4) },
    error: null,
  });

  return NextResponse.json({ ok: true, maskedKey: mask(apiKey), source: "byok" });
}

// DELETE /api/tenant/ai — remover o override BYOK (volta a usar a chave da plataforma)
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const tenantId = me.tenant_id as string;

  const { error } = await admin
    .from("integrations")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("type", "openai");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("events_log").insert({
    tenant_id: tenantId,
    session_id: null,
    event_type: "integration_updated",
    payload: { type: "openai", removed: true },
    error: null,
  });

  return NextResponse.json({ ok: true });
}
