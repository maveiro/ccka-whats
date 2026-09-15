import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Conexão com o painel-shows: admin-only, e o token nunca é devolvido.
// `agenda_conexoes` é deny-all (mesmo padrão de whatsapp_cloud_credentials),
// então escrita e leitura passam por admin client — exceção legítima à regra
// 15, como o `integrations`.

async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (operator?.role !== "admin") return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { tenantId: operator.tenant_id };
}

export async function GET() {
  const auth = await admin();
  if ("erro" in auth) return auth.erro;

  const { data } = await createAdminClient()
    .from("agenda_conexoes")
    .select("base_url, ativo, updated_at")
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  return NextResponse.json({ configurada: !!data, ...(data ?? {}) });
}

export async function PUT(req: NextRequest) {
  const auth = await admin();
  if ("erro" in auth) return auth.erro;

  const body = await req.json() as { baseUrl?: unknown; token?: unknown; ativo?: unknown };
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!/^https:\/\/.+/.test(baseUrl)) {
    return NextResponse.json({ error: "A URL do painel-shows precisa começar com https://" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: "Token é obrigatório" }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("agenda_conexoes")
    .upsert({
      tenant_id: auth.tenantId,
      base_url: baseUrl,
      token,
      ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
