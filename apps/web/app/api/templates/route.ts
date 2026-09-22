import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { listMessageTemplates } from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredential, getCloudCredentialById } from "@/lib/whatsapp-cloud/getCloudCredential";

// GET — lista TODO template da WABA (qualquer status), para a tela de
// gestão (/dashboard/admin/templates). Irmã de /api/campaigns/templates,
// que filtra só APPROVED (o que se pode disparar); aqui é o inverso: o
// admin precisa ver pendente e rejeitado (com o motivo) para acompanhar a
// revisão da Meta. Ver docs/prd/prd-criacao-de-templates.md.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Mesmo padrão do assistente de campanha (regra 58): template é da WABA,
  // não do número, mas o seletor de número decide qual WABA consultar.
  const credentialId = new URL(req.url).searchParams.get("credentialId");
  const credential = credentialId
    ? await getCloudCredentialById(credentialId)
    : await getCloudCredential(operator.tenant_id);

  if (!credential) {
    return NextResponse.json({ error: "Nenhuma credencial do WhatsApp Cloud API cadastrada" }, { status: 404 });
  }

  // IDOR-safe: id de credencial vem do client, então confere que é do
  // tenant de quem pergunta antes de usar (mesma checagem de
  // /api/campaigns/templates).
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
    return NextResponse.json({ credentialId: credential.id, templates });
  } catch (err) {
    const admin = createAdminClient();
    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "error",
      payload: { source: "templates" },
      error: String(err),
    });
    return NextResponse.json({ error: "Falha ao buscar templates na Graph API" }, { status: 502 });
  }
}
