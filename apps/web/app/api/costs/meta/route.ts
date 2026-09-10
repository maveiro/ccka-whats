import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getPricingAnalytics, GraphApiError, type PricingAnalyticsPoint } from "@/lib/whatsapp-cloud/graphClient";

// Conferência: agregado oficial de custo da Meta (pricing_analytics) para o
// mesmo período do ledger local. Rota SEPARADA de /api/costs de propósito —
// a tela renderiza com o ledger e busca isto depois, para que Graph API fora
// do ar não derrube a página de custos.
//
// whatsapp_cloud_credentials é deny-all: só o admin client lê (mesma exceção
// legítima à regra 15 já usada em campaigns/page.tsx), com .eq("tenant_id")
// obrigatório.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "Parâmetros 'from' e 'to' são obrigatórios (ISO 8601)" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: credentials } = await admin
    .from("whatsapp_cloud_credentials")
    .select("waba_id, access_token")
    .eq("tenant_id", operator.tenant_id)
    .eq("active", true);

  if (!credentials?.length) {
    return NextResponse.json({ error: "Nenhuma credencial do WhatsApp Cloud API cadastrada" }, { status: 404 });
  }

  // Vários números podem compartilhar a mesma WABA — pricing_analytics é por
  // WABA, então consultar uma vez por WABA distinta evita somar em dobro.
  const porWaba = new Map<string, string>();
  for (const c of credentials as { waba_id: string; access_token: string }[]) {
    if (!porWaba.has(c.waba_id)) porWaba.set(c.waba_id, c.access_token);
  }

  const points: PricingAnalyticsPoint[] = [];
  const erros: string[] = [];

  for (const [wabaId, accessToken] of porWaba) {
    try {
      points.push(...await getPricingAnalytics(wabaId, accessToken, {
        start: new Date(from),
        end: new Date(to),
        granularity: "DAILY",
      }));
    } catch (err) {
      erros.push(err instanceof GraphApiError ? `${wabaId}: ${err.message}` : `${wabaId}: ${String(err)}`);
    }
  }

  const totalCost = points.reduce((acc, p) => acc + (p.cost ?? 0), 0);
  const totalVolume = points.reduce((acc, p) => acc + (p.volume ?? 0), 0);

  const porCategoria = new Map<string, { messages: number; cost: number }>();
  for (const p of points) {
    const chave = (p.pricing_category ?? "desconhecida").toLowerCase();
    const atual = porCategoria.get(chave) ?? { messages: 0, cost: 0 };
    atual.messages += p.volume ?? 0;
    atual.cost += p.cost ?? 0;
    porCategoria.set(chave, atual);
  }

  return NextResponse.json({
    totalCost,
    totalVolume,
    byCategory: [...porCategoria].map(([category, v]) => ({ category, ...v })),
    // A Meta é explícita: "cost data is approximate and may differ from
    // invoiced amounts". Sem custo nenhum aqui costuma significar WABA
    // faturada por Solution Partner, não gasto zero.
    approximate: true,
    errors: erros,
  });
}
