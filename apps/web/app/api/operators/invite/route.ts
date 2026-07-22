import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isGoogleOnlyEmail } from "@/lib/google-only-domains";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, name, role, tenantId } = await req.json();

  if (!email || !tenantId) {
    return NextResponse.json({ error: "email and tenantId are required" }, { status: 400 });
  }

  if (tenantId !== operator.tenant_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createAdminClient();
  const googleOnly = isGoogleOnlyEmail(email);
  let newUserId: string;

  if (googleOnly) {
    // Login é só via Google pra esse domínio — sem senha, sem e-mail de convite.
    // A pessoa já pode entrar direto em "Entrar com Google" assim que a linha em
    // operators existir (checado em /auth/callback).
    const { data: newUser, error: createError } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }
    newUserId = newUser.user.id;
  } else {
    // Criar usuário via Supabase Admin (envia e-mail de convite p/ definir senha)
    const { data: newUser, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { name },
      redirectTo: `${req.nextUrl.origin}/login`,
    });
    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }
    newUserId = newUser.user.id;
  }

  // Criar registro na tabela operators
  const { error: opError } = await service
    .from("operators")
    .insert({
      id: newUserId,
      tenant_id: tenantId,
      name: name ?? null,
      email,
      role: role ?? "operator",
      active: true,
    });

  if (opError) {
    return NextResponse.json({ error: opError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, authMethod: googleOnly ? "google" : "password" });
}
