import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: session } = await supabase
    .from("wa_sessions")
    .select("evolution_instance_name")
    .eq("id", id)
    .single();

  if (!session?.evolution_instance_name) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Buscar QR code diretamente da Evolution API
  const evoRes = await fetch(
    `${env.EVOLUTION_API_URL}/instance/connect/${session.evolution_instance_name}`,
    { headers: { "apikey": env.EVOLUTION_API_KEY } },
  );

  if (!evoRes.ok) {
    const text = await evoRes.text();
    return NextResponse.json({ error: `Evolution: ${evoRes.status} ${text}` }, { status: 502 });
  }

  const raw = await evoRes.json() as Record<string, unknown>;

  // Tentar extrair QR de diferentes formatos da Evolution API
  const qrCode: string | null =
    (raw.base64 as string | undefined) ??
    ((raw.qrcode as Record<string, unknown> | undefined)?.base64 as string | undefined) ??
    null;

  if (qrCode) {
    // Salvar no banco para o Realtime propagar ao card
    const { createAdminClient } = await import("@/lib/supabase/server");
    const admin = createAdminClient();
    await admin
      .from("wa_sessions")
      .update({ qr_code: qrCode, status: "connecting" })
      .eq("id", id);
  }

  return NextResponse.json({
    qrCode,
    rawKeys: Object.keys(raw), // para debug: mostra quais campos vieram
  });
}
