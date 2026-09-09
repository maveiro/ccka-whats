import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Editar/remover um show da agenda. Exclusão é admin-only pela RLS
// (migration 0025) — e aqui é DELETE de verdade, não soft-delete: a tabela é
// uma cópia de trabalho (na V2 vira espelho do painel-shows), não registro
// histórico. Show cancelado que precise sumir da agenda do Flow não deve
// deixar rastro que o endpoint tenha de filtrar.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.artista === "string" && body.artista.trim()) patch.artista = body.artista.trim();
  for (const [campoApi, coluna] of [
    ["cidade", "cidade"],
    ["teatro", "teatro"],
    ["statusVenda", "status_venda"],
    ["linkCompra", "link_compra"],
  ] as const) {
    if (typeof body[campoApi] === "string") {
      patch[coluna] = (body[campoApi] as string).trim() || null;
    }
  }
  if (typeof body.dataShow === "string") {
    if (!body.dataShow) {
      patch.data_show = null;
    } else {
      const d = new Date(body.dataShow);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Data do show inválida" }, { status: 400 });
      }
      patch.data_show = d.toISOString();
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agenda_shows_sync")
    .update(patch)
    .eq("id", id)
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Show não encontrado" }, { status: 404 });

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
    return NextResponse.json({ error: "Só admin pode remover um show" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("agenda_shows_sync")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Show não encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
