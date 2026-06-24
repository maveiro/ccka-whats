import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as { label?: unknown; phoneNumber?: unknown; instanceName?: unknown };
  const { label, phoneNumber, instanceName } = body;

  if (
    typeof label !== "string" || !label.trim() ||
    typeof phoneNumber !== "string" || !phoneNumber.trim() ||
    typeof instanceName !== "string" || !instanceName.trim()
  ) {
    return NextResponse.json({ error: "label, phoneNumber and instanceName are required" }, { status: 400 });
  }

  // 1. Create Evolution instance
  const evoCreateRes = await fetch(`${env.EVOLUTION_API_URL}/instance/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    }),
  });

  if (!evoCreateRes.ok) {
    const text = await evoCreateRes.text();
    return NextResponse.json({ error: `Evolution API error: ${text}` }, { status: 502 });
  }

  // 2. Generate webhook secret
  const webhookSecret =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const webhookUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  // 3. Insert into wa_sessions
  const admin = createAdminClient();
  const { data: newSession, error: insertError } = await admin
    .from("wa_sessions")
    .insert({
      tenant_id: operator.tenant_id,
      label: label.trim(),
      phone_number: phoneNumber.trim(),
      evolution_instance_name: instanceName.trim(),
      status: "disconnected",
      webhook_secret: webhookSecret,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // 4. Register webhook on Evolution instance (fire-and-forget on failure)
  const evoWebhookRes = await fetch(
    `${env.EVOLUTION_API_URL}/webhook/set/${instanceName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          headers: { Authorization: `Bearer ${webhookSecret}` },
          enabled: true,
          webhookBase64: false,
          webhookByEvents: false,
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

  if (!evoWebhookRes.ok) {
    console.error("Webhook registration failed:", await evoWebhookRes.text());
  }

  return NextResponse.json(newSession, { status: 201 });
}
