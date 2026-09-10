import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Agregado de custo por disparo, direto do ledger whatsapp_message_costs.
// Toda a agregação acontece no Postgres (RPC costs_summary, migration custos_cloud_api)
// — não repetir o scan paginado do /api/analytics, que já é dívida conhecida
// (CLAUDE.md, "Escala do Analytics").
//
// A RPC deriva o tenant de my_tenant_id() e exige admin, então é chamada com
// o client AUTENTICADO do usuário (não service role): sem isso my_tenant_id()
// volta null e a função nega. Isolamento continua no RLS/Postgres (regra 15).

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const sessionId = url.searchParams.get("sessionId");

  if (!from || !to) {
    return NextResponse.json({ error: "Parâmetros 'from' e 'to' são obrigatórios (ISO 8601)" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("costs_summary", {
    p_from: from,
    p_to: to,
    p_session_id: sessionId || null,
  });

  if (error) {
    if (error.message.includes("forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
