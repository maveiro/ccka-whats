import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.pergunta === "string" && body.pergunta.trim()) patch.pergunta = body.pergunta.trim();
  if (typeof body.resposta === "string" && body.resposta.trim()) patch.resposta = body.resposta.trim();
  if (typeof body.artista === "string") patch.artista = body.artista.trim() || null;
  if (typeof body.ordem === "number") patch.ordem = body.ordem;
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("faq_itens").update(patch).eq("id", id).is("deleted_at", null)
    .select("id, artista, pergunta, resposta, ordem, ativo, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Pergunta não encontrada" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role").eq("id", user.id).single<{ role: string }>();
  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode remover uma pergunta" }, { status: 403 });
  }

  // Soft-delete: a pergunta pode ter sido lida por muita gente, e o histórico
  // de qual resposta estava no ar importa se alguém reclamar do conteúdo.
  const { data, error } = await supabase
    .from("faq_itens")
    .update({ deleted_at: new Date().toISOString(), ativo: false })
    .eq("id", id).is("deleted_at", null)
    .select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Pergunta não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
