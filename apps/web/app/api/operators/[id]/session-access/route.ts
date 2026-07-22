import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// PUT /api/operators/[id]/session-access — definir escopo de sessões do operador
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { scope?: unknown; sessionIds?: unknown };

  if (body.scope !== "all" && body.scope !== "restricted") {
    return NextResponse.json({ error: "scope deve ser 'all' ou 'restricted'" }, { status: 400 });
  }
  if (body.scope === "restricted" && !Array.isArray(body.sessionIds)) {
    return NextResponse.json({ error: "sessionIds é obrigatório quando scope='restricted'" }, { status: 400 });
  }
  const sessionIds = (body.sessionIds as string[] | undefined) ?? [];

  const admin = createAdminClient();

  // Garantir que o operador alvo é do mesmo tenant
  const { data: target } = await admin
    .from("operators")
    .select("tenant_id")
    .eq("id", id)
    .single();

  if (!target || target.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: "Operador não encontrado" }, { status: 404 });
  }

  // Garantir que as sessões pertencem ao mesmo tenant (evita IDOR)
  if (sessionIds.length > 0) {
    const { data: validSessions } = await admin
      .from("wa_sessions")
      .select("id")
      .eq("tenant_id", target.tenant_id)
      .in("id", sessionIds);

    if ((validSessions?.length ?? 0) !== sessionIds.length) {
      return NextResponse.json({ error: "Alguma sessão informada não pertence a este tenant" }, { status: 400 });
    }
  }

  const { error: updateErr } = await admin
    .from("operators")
    .update({ session_scope: body.scope })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { error: deleteErr } = await admin
    .from("operator_session_access")
    .delete()
    .eq("operator_id", id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  if (body.scope === "restricted" && sessionIds.length > 0) {
    const { error: insertErr } = await admin
      .from("operator_session_access")
      .insert(sessionIds.map((sessionId) => ({
        operator_id: id,
        session_id: sessionId,
        tenant_id: target.tenant_id,
      })));
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await admin.from("events_log").insert({
    tenant_id: target.tenant_id,
    session_id: null,
    event_type: "operator_access_updated",
    payload: { operator_id: id, scope: body.scope, session_ids: sessionIds },
    error: null,
  });

  return NextResponse.json({ ok: true });
}
