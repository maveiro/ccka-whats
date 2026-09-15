import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH/DELETE de uma agenda sincronizada. Next.js 16: params é Promise.
// A RLS (acesso_por_numero) é quem autoriza; aqui só validamos o corpo.

async function autorizar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { role: operator.role };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;
  const { id } = await params;

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof body.artistaOrigem === "string" && body.artistaOrigem.trim()) {
    patch.artista_origem = body.artistaOrigem.trim();
  }
  if (Array.isArray(body.statusPermitidos)) {
    if (body.statusPermitidos.length === 0) {
      // O banco também recusa (constraint): allowlist vazia devolve agenda em
      // branco sem erro nenhum.
      return NextResponse.json({ error: "Escolha ao menos um status" }, { status: 400 });
    }
    patch.status_permitidos = body.statusPermitidos as string[];
  }
  if ("espetaculos" in body) {
    patch.espetaculos = Array.isArray(body.espetaculos) && body.espetaculos.length > 0
      ? body.espetaculos as string[]
      : null;
  }
  if ("janelaDias" in body) {
    patch.janela_dias = typeof body.janelaDias === "number" && body.janelaDias > 0 ? body.janelaDias : null;
  }
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada a atualizar" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("agenda_filtros").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const supabase = await createClient();
  // As linhas sincronizadas ficam (filtro_id vira null pelo FK) em vez de
  // desaparecerem junto: apagar a configuração não devia apagar a agenda que
  // o fã está vendo. Elas passam a ser linhas sem procedência, editáveis à
  // mão como as manuais.
  const { error } = await supabase.from("agenda_filtros").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
