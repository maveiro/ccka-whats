import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// Sessões com histórico grande levam dezenas de segundos pra apagar em lotes
// na Edge Function (ver supabase/functions/delete-session) — precisa de mais
// que o default do Vercel.
export const maxDuration = 90;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const { data: session } = await supabase
    .from("wa_sessions")
    .select("id")
    .eq("id", id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Exclusão (Evolution API + cascade de messages/chats em lotes + events_log)
  // roda na Edge Function delete-session — um DELETE cascata direto via
  // PostgREST/RPC estoura o timeout de ~9s da API pra sessões com muito
  // histórico (30k+ mensagens).
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ sessionId: id }),
    },
  );

  const data = await res.json().catch(() => null) as { error?: string } | null;

  if (!res.ok) {
    return NextResponse.json({ error: data?.error ?? "Falha ao excluir sessão" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
