import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST(
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
    .select("evolution_instance_name")
    .eq("id", id)
    .single();

  if (!session?.evolution_instance_name) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const newSecret =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  const evoRes = await fetch(
    `${env.EVOLUTION_API_URL}/webhook/set/${session.evolution_instance_name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          headers: { Authorization: `Bearer ${newSecret}` },
          webhookBase64: false,
          webhookByEvents: false,
          enabled: true,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
          ],
        },
      }),
    },
  );

  if (!evoRes.ok) {
    const text = await evoRes.text();
    return NextResponse.json({ error: `Evolution API error: ${text}` }, { status: 502 });
  }

  const service = createAdminClient();
  const { error: dbError } = await service
    .from("wa_sessions")
    .update({ webhook_secret: newSecret })
    .eq("id", id);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ webhook_secret: newSecret, webhook_url: webhookUrl });
}
