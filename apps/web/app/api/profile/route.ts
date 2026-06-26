import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// PATCH /api/profile
// body: { name?: string; password?: string; currentPassword?: string }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    name?: unknown;
    password?: unknown;
    currentPassword?: unknown;
  };

  const { name, password, currentPassword } = body;

  // Validar nome
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
    }
  }

  // Validar senha
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Nova senha deve ter no mínimo 8 caracteres" }, { status: 400 });
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return NextResponse.json({ error: "Senha atual é obrigatória" }, { status: 400 });
    }

    // Verificar senha atual via sign-in silencioso
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });
    if (signInError) {
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const updates: Record<string, unknown> = {};

  // Atualizar nome no operador
  if (name !== undefined) {
    const { error: nameErr } = await admin
      .from("operators")
      .update({ name: (name as string).trim() })
      .eq("id", user.id);
    if (nameErr) return NextResponse.json({ error: nameErr.message }, { status: 500 });
    updates.name = (name as string).trim();
  }

  // Atualizar senha no Auth
  if (password !== undefined) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, {
      password: password as string,
    });
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 });
    updates.password = true;
  }

  return NextResponse.json({ ok: true, updated: updates });
}
