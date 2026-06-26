import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// PATCH /api/operators/[id]  — alterar role ou active
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (id === user.id) return NextResponse.json({ error: "Não é possível editar a própria conta aqui" }, { status: 400 });

  const body = await req.json() as { role?: unknown; active?: unknown };
  const patch: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "operator") {
      return NextResponse.json({ error: "role deve ser admin ou operator" }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active deve ser boolean" }, { status: 400 });
    }
    patch.active = body.active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Garantir que o operador alvo é do mesmo tenant
  const { data: target } = await admin
    .from("operators")
    .select("tenant_id")
    .eq("id", id)
    .single();

  if (!target || target.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: "Operador não encontrado" }, { status: 404 });
  }

  const { error } = await admin.from("operators").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/operators/[id]  — remover operador
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (id === user.id) return NextResponse.json({ error: "Não é possível excluir a própria conta" }, { status: 400 });

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("operators")
    .select("tenant_id")
    .eq("id", id)
    .single();

  if (!target || target.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: "Operador não encontrado" }, { status: 404 });
  }

  // Remover do Auth (cascade remove da tabela operators via FK)
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
