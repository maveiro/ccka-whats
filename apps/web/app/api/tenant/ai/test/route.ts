import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantOpenAIKey, validateOpenAIKey } from "@/lib/ai";

// POST /api/tenant/ai/test — testar conexão com a OpenAI.
// body opcional: { apiKey?: string } — testa a chave recém-digitada (pré-save);
// sem body, testa a chave resolvida do tenant (BYOK ou plataforma).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { apiKey?: unknown } = {};
  try {
    body = await req.json() as { apiKey?: unknown };
  } catch {
    // sem body — testa a chave resolvida
  }

  const typed = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const key = typed || (await getTenantOpenAIKey(supabase)).key;

  if (!key) {
    return NextResponse.json({ ok: false, reason: "invalid", error: "Nenhuma chave configurada" });
  }

  const result = await validateOpenAIKey(key);
  return NextResponse.json(result);
}
