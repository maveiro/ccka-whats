import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// Idempotente por construção: o UPDATE só afeta a linha se status for
// 'ready' (primeiro disparo) ou 'paused' (retomada após teto de tier de
// mensageria — ver campaign-sender, MESSAGING_LIMIT_CODES). Um duplo-clique/
// retry que não encontra a linha num desses estados não invoca a Edge
// Function de novo — retorna "já disparando" em vez de duplicar o job.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from("campaigns")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", operator.tenant_id)
    .in("status", ["ready", "paused"])
    .select("id")
    .maybeSingle();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (!updated) {
    const { data: current } = await admin.from("campaigns").select("status").eq("id", id).single();
    return NextResponse.json({ ok: false, reason: "already_fired_or_not_ready", status: current?.status ?? "unknown" }, { status: 409 });
  }

  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "campaign_fired",
    payload: { campaignId: id },
  });

  const senderUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/campaign-sender`;
  const res = await fetch(senderUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ campaignId: id }),
  });

  if (!res.ok) {
    console.error("campaign-sender invocation failed:", await res.text());
    // Não falha a request — pg_cron reinvoca a function no próximo tick
    // (campanha já está 'sending', o claim atômico cuida do resto).
  }

  return NextResponse.json({ ok: true });
}
