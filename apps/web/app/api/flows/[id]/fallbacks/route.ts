import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// "O que caiu em fallback recentemente" — o sinal de que falta uma palavra-
// chave (PRD, seção "Interface self-service"). Alimenta a revisão periódica
// que mantém a lista de keywords viva.
//
// events_log tem RLS de SELECT admin-only, e esta tela é admin E operator.
// Por isso a leitura vai pelo admin client com `.eq("tenant_id", ...)`
// explícito — mesma exceção documentada da regra 15 — mas só DEPOIS de a RLS
// confirmar, pelo client autenticado, que quem pede enxerga aquele Flow.
// Assim o operator vê o fallback dos números dele sem ganhar acesso ao
// events_log inteiro do tenant.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: flowId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("tenant_id")
    .eq("id", user.id)
    .single<{ tenant_id: string }>();
  if (!operator) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // A RLS decide se este usuário enxerga este Flow (has_cloud_credential_access).
  const { data: flow } = await supabase
    .from("whatsapp_flows")
    .select("id")
    .eq("id", flowId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!flow) return NextResponse.json({ error: "Flow não encontrado" }, { status: 404 });

  const limite = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20, 100);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("events_log")
    .select("id, created_at, payload")
    .eq("tenant_id", operator.tenant_id)
    .eq("event_type", "flow_fallback")
    .eq("payload->>flowId", flowId)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    (data ?? []).map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        createdAt: e.created_at,
        texto: typeof p.texto === "string" ? p.texto : "",
        telefone: typeof p.telefone === "string" ? p.telefone : null,
        chatId: typeof p.chatId === "string" ? p.chatId : null,
      };
    }),
  );
}
