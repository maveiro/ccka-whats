import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Autorização comum das rotas de página pública. Admin e operator — mesmo par
// que administra agenda e Flows (é conteúdo, não credencial).
export async function autorizarPagina(): Promise<
  { erro: NextResponse } | { tenantId: string; role: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { tenantId: operator.tenant_id, role: operator.role };
}
