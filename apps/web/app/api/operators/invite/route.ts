import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

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

  // Criar usuário via Supabase Admin (envia e-mail de convite)
  const { data: newUser, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { name },
    redirectTo: `${req.nextUrl.origin}/login`,
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  // Criar registro na tabela operators
  const { error: opError } = await service
    .from("operators")
    .insert({
      id: newUser.user.id,
      tenant_id: tenantId,
      name: name ?? null,
      email,
      role: role ?? "operator",
      active: true,
    });

  if (opError) {
    return NextResponse.json({ error: opError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
