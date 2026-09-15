import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// "Sincronizar agora": invoca a Edge Function agenda-sync com service role.
// Fora daqui, quem chama é o pg_cron (de hora em hora, migration
// agenda_sync_cron).
//
// maxDuration: a função busca a API do painel-shows e grava por agenda; o
// default de 15s da Vercel é apertado para um board grande.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { filtroId?: unknown };

  // tenantId vem do operador autenticado, nunca do corpo: senão um admin de um
  // tenant dispararia o sync de outro.
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agenda-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      tenantId: operator.tenant_id,
      ...(typeof body.filtroId === "string" ? { filtroId: body.filtroId } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: (json as { error?: string }).error ?? `Erro ${res.status}` }, { status: 502 });
  }
  return NextResponse.json(json);
}
