import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { GraphApiError, updateMessageTemplate } from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredentialById } from "@/lib/whatsapp-cloud/getCloudCredential";
import { montarComponentes, type TemplateFormInput } from "@/lib/whatsapp-cloud/templateComponents";
import { resolverBotaoFlow } from "@/lib/whatsapp-cloud/resolverBotaoFlow";
import { env } from "@/lib/env";

interface EditBody {
  credentialId?: string;
  templateId?: string;
  category?: string;
  headerTexto?: string | null;
  headerExemplo?: string | null;
  headerMidia?: TemplateFormInput["headerMidia"];
  bodyTexto?: string;
  bodyExemplos?: string[];
  footerTexto?: string | null;
  botao?: TemplateFormInput["botao"];
}

// POST — edita e reenvia um template para revisão. A Graph API só aceita
// isto para templates REJECTED (achado ao vivo, 22/09/2026 — ver
// updateMessageTemplate em graphClient.ts); tentar noutro status volta o
// erro da própria Meta, repassado como veio, sem checagem duplicada aqui.
//
// `name` e `language` não entram no corpo — são a identidade do template
// (o `templateId` da Meta já resolve para um par name+language fixo).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as EditBody;

  if (!body.credentialId || !body.templateId) {
    return NextResponse.json({ error: "Faltam credentialId/templateId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: dono } = await admin
    .from("whatsapp_cloud_credentials")
    .select("tenant_id")
    .eq("id", body.credentialId)
    .maybeSingle();
  if (dono?.tenant_id !== operator.tenant_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const credential = await getCloudCredentialById(body.credentialId);
  if (!credential) return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });

  const category = (body.category ?? "").toUpperCase();
  if (!["MARKETING", "UTILITY"].includes(category)) {
    return NextResponse.json({ error: "Categoria precisa ser Marketing ou Utility" }, { status: 400 });
  }

  const resolvido = await resolverBotaoFlow(operator.tenant_id, credential.id, body.botao ?? null);
  if (!resolvido.ok) return NextResponse.json({ error: resolvido.erro }, { status: 400 });

  const montagem = montarComponentes(
    {
      headerTexto: body.headerTexto ?? null,
      bodyTexto: body.bodyTexto ?? "",
      footerTexto: body.footerTexto ?? null,
      headerExemplo: body.headerExemplo ?? null,
      bodyExemplos: body.bodyExemplos ?? [],
      headerMidia: body.headerMidia ?? null,
      botao: resolvido.botao,
    },
    env.NEXT_PUBLIC_LINK_BASE_URL ?? null,
  );
  if (!montagem.ok) return NextResponse.json({ error: montagem.erro }, { status: 400 });

  try {
    const editado = await updateMessageTemplate({
      templateId: body.templateId,
      accessToken: credential.access_token,
      category: category as "MARKETING" | "UTILITY",
      components: montagem.components!,
    });

    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "template_editado",
      payload: { templateId: body.templateId, category, credentialId: credential.id },
    });

    return NextResponse.json({ ok: true, ...editado });
  } catch (err) {
    // "Os modelos de mensagem só podem ser editados se tiverem sido
    // rejeitados" cai aqui quando o status mudou entre a tela carregar e o
    // envio — repassado como veio, é a explicação certa.
    const mensagem = err instanceof GraphApiError ? err.message : "Falha ao editar template na Graph API";
    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "template_editado",
      payload: { templateId: body.templateId, category, credentialId: credential.id },
      error: mensagem,
    });
    return NextResponse.json({ error: mensagem }, { status: 502 });
  }
}
