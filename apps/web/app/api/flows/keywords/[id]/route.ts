import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Editar/remover uma palavra-chave. Remoção é soft-delete e admin-only, pela
// mesma simetria da exclusão de Flow (regra 21) — a RLS de DELETE em
// flow_palavras_chave também é admin-only, mas soft-delete é UPDATE, então a
// checagem de role precisa ser explícita aqui.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { palavraChave?: unknown; resposta?: unknown; tipoResposta?: unknown };

  const patch: Record<string, unknown> = {};
  if (typeof body.palavraChave === "string" && body.palavraChave.trim()) {
    patch.palavra_chave = body.palavraChave.trim();
  }
  if (typeof body.resposta === "string" && body.resposta.trim()) patch.resposta = body.resposta.trim();
  if (typeof body.tipoResposta === "string" && ["texto", "link"].includes(body.tipoResposta)) {
    patch.tipo_resposta = body.tipoResposta;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("flow_palavras_chave")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, palavra_chave, tipo_resposta, resposta, flow_destino_id")
    .maybeSingle();

  if (error) {
    const duplicada = error.code === "23505";
    return NextResponse.json(
      { error: duplicada ? "Esta palavra-chave já existe neste Flow" : error.message },
      { status: duplicada ? 409 : 500 },
    );
  }
  if (!data) return NextResponse.json({ error: "Palavra-chave não encontrada" }, { status: 404 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode remover uma palavra-chave" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("flow_palavras_chave")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Palavra-chave não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
