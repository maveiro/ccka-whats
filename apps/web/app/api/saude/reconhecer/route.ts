import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Reconhecer um erro: para de contar no selo, mas NÃO apaga. Ocorrência nova
// depois do reconhecimento volta a contar — senão um erro reconhecido uma vez
// ficaria invisível para sempre, que é pior que não ter tela.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role, tenant_id").eq("id", user.id).single<{ role: string; tenant_id: string }>();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { assinatura?: unknown; desfazer?: unknown };
  const assinatura = typeof body.assinatura === "string" ? body.assinatura : "";
  if (!assinatura) return NextResponse.json({ error: "Assinatura é obrigatória" }, { status: 400 });

  if (body.desfazer === true) {
    const { error } = await supabase
      .from("erros_reconhecidos").delete()
      .eq("tenant_id", operator.tenant_id).eq("assinatura", assinatura);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, reconhecido: false });
  }

  const { error } = await supabase.from("erros_reconhecidos").upsert({
    tenant_id: operator.tenant_id,
    assinatura,
    reconhecido_em: new Date().toISOString(),
    reconhecido_por: user.id,
  }, { onConflict: "tenant_id,assinatura" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reconhecido: true });
}
