import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Números autorizados a usar o comando "/reset" no WhatsApp.
//
// A autorização de verdade está no banco (resetar_cadastro_teste só age sobre
// números desta lista) — esta rota só administra a lista. Admin-only: liberar
// um número aqui permite apagar o cadastro dele por mensagem.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("numeros_de_teste")
    .select("id, telefone, nota, created_at")
    .order("created_at", { ascending: false });

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
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as Record<string, unknown>;
  const telefone = typeof body.telefone === "string" ? body.telefone.trim() : "";
  if (telefone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Informe o telefone com DDD" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("numeros_de_teste")
    .insert({
      tenant_id: operator.tenant_id,
      telefone,
      nota: typeof body.nota === "string" && body.nota.trim() ? body.nota.trim() : null,
    })
    .select("id, telefone, nota, created_at")
    .single();

  if (error) {
    const duplicado = error.code === "23505";
    return NextResponse.json(
      { error: duplicado ? "Este número já está na lista" : error.message },
      { status: duplicado ? 409 : 500 },
    );
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role").eq("id", user.id).single<{ role: string }>();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  const { error } = await supabase.from("numeros_de_teste").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
