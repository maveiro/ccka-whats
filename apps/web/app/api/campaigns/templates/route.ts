import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { listMessageTemplates } from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredential, getCloudCredentialById } from "@/lib/whatsapp-cloud/getCloudCredential";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ?credentialId= escolhe o número; sem ele, cai na credencial mais antiga
  // do tenant (comportamento de quando havia um número só). O seletor de
  // número na UI de campanhas entra na Sprint A2 — até lá esta rota continua
  // funcionando sem parâmetro, agora sem quebrar quando o tenant tem N
  // números ativos (ver nota em lib/whatsapp-cloud/getCloudCredential.ts).
  const credentialId = new URL(req.url).searchParams.get("credentialId");
  const credential = credentialId
    ? await getCloudCredentialById(credentialId)
    : await getCloudCredential(operator.tenant_id);

  if (!credential) {
    return NextResponse.json({ error: "Nenhuma credencial do WhatsApp Cloud API cadastrada" }, { status: 404 });
  }

  // Credencial pedida por id tem que ser do tenant de quem pergunta — o id vem
  // do client, então sem esta checagem seria IDOR: um admin listaria templates
  // da WABA de outro tenant.
  if (credentialId) {
    const admin = createAdminClient();
    const { data: dono } = await admin
      .from("whatsapp_cloud_credentials")
      .select("tenant_id")
      .eq("id", credential.id)
      .maybeSingle();
    if (dono?.tenant_id !== operator.tenant_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
