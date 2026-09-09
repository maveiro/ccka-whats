import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// FAQ da Central de Shows. Autorização é da RLS (migration 0030): leitura para
// o tenant, escrita para admin e operator, exclusão admin-only — mesmo par que
// administra Flows e agenda, porque FAQ é conteúdo da automação.
//
// `artista` nulo significa "vale para todos os artistas do tenant"; o endpoint
// do Flow filtra por artista do número OU nulo.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("faq_itens")
    .select("id, artista, pergunta, resposta, ordem, ativo, updated_at")
    .is("deleted_at", null)
    .order("ordem", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role, tenant_id").eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();
  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim() : "";
  const resposta = typeof body.resposta === "string" ? body.resposta.trim() : "";
  if (!pergunta || !resposta) {
    return NextResponse.json({ error: "Pergunta e resposta são obrigatórias" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("faq_itens")
    .insert({
      tenant_id: operator.tenant_id,
      artista: typeof body.artista === "string" && body.artista.trim() ? body.artista.trim() : null,
      pergunta,
      resposta,
      ordem: typeof body.ordem === "number" ? body.ordem : 0,
      ativo: true,
    })
    .select("id, artista, pergunta, resposta, ordem, ativo, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
