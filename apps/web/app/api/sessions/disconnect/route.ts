import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin" && operator?.role !== "operator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await req.json();

  const { data: session } = await supabase
    .from("wa_sessions")
    .select("evolution_instance_name")
    .eq("id", sessionId)
    .single();

  if (!session?.evolution_instance_name) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Desconectar no Evolution API
  const evoRes = await fetch(
    `${env.EVOLUTION_API_URL}/instance/logout/${session.evolution_instance_name}`,
    { method: "DELETE", headers: { "apikey": env.EVOLUTION_API_KEY } },
  );

  if (!evoRes.ok) {
    const text = await evoRes.text();
    return NextResponse.json({ error: text }, { status: 502 });
  }

  const service = createAdminClient();
  await service
    .from("wa_sessions")
    .update({ status: "disconnected", qr_code: null })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
