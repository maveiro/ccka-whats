import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Resumo de erros do events_log, agregado no banco por assinatura.
// Admin-only: é diagnóstico de infraestrutura, não conteúdo.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role").eq("id", user.id).single<{ role: string }>();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const horas = Math.min(Math.max(Number(req.nextUrl.searchParams.get("horas") ?? 24) || 24, 1), 720);

  const { data, error } = await supabase.rpc("resumo_de_erros", { p_horas: horas });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ horas, erros: data ?? [] });
}
