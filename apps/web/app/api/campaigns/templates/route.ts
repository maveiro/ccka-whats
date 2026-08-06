import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { listMessageTemplates } from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredential } from "@/lib/whatsapp-cloud/getCloudCredential";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const credential = await getCloudCredential(operator.tenant_id);
  if (!credential) {
    return NextResponse.json({ error: "Nenhuma credencial do WhatsApp Cloud API cadastrada" }, { status: 404 });
  }

  try {
    const templates = await listMessageTemplates(credential.waba_id, credential.access_token);
    return NextResponse.json({
      credentialId: credential.id,
      templates: templates.filter((t) => t.status === "APPROVED"),
    });
  } catch (err) {
    const admin = createAdminClient();
    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "error",
      payload: { source: "campaigns/templates" },
      error: String(err),
    });
    return NextResponse.json({ error: "Falha ao buscar templates na Graph API" }, { status: 502 });
  }
}
