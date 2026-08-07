import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Relatório de disparo — uma linha por destinatário, usado pro export CSV
// em campaigns-list.tsx. campaign_recipients tem RLS admin_only normal
// (não deny-all), o client autenticado resolve direto.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, tenant_id")
    .eq("id", id)
    .single();
  if (!campaign || campaign.tenant_id !== operator.tenant_id) {
    return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  }

  // PostgREST tem max_rows=1000 (supabase/config.toml) — uma campanha real
  // pode ter milhares de destinatários (achado em produção: uma campanha de
  // 5.043 exportou só os primeiros 1.000, sem aviso, dando um relatório
  // silenciosamente incompleto). Pagina em páginas de PAGE_SIZE até esgotar.
  const PAGE_SIZE = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("campaign_recipients")
      .select("phone_e164, status, wamid, error, attempts, button_reply, button_reply_at, sent_at, delivered_at, read_at, failed_at, created_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return NextResponse.json(rows);
}
