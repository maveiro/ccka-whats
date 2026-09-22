import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { createMessageTemplate, GraphApiError, listMessageTemplates } from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredential, getCloudCredentialById } from "@/lib/whatsapp-cloud/getCloudCredential";
import {
  montarComponentes,
  slugifyNomeTemplate,
  type TemplateFormInput,
} from "@/lib/whatsapp-cloud/templateComponents";

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

interface CreateBody {
  credentialId?: string;
  titulo?: string;
  category?: string;
  language?: string;
  headerTexto?: string | null;
  headerExemplo?: string | null;
  bodyTexto?: string;
  bodyExemplos?: string[];
  footerTexto?: string | null;
  botao?: TemplateFormInput["botao"];
}

// POST — cria e submete um template para revisão da Meta (Fase 2 do PRD).
// A validação de formato (limites de caractere, contagem de variável,
// convenção da URL rastreada) mora em templateComponents.ts, puro e
// testado — esta rota só resolve credencial, monta `name`/`category` e
// repassa o erro da Graph API como veio, sem reescrever.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as CreateBody;

  if (!body.credentialId) {
    return NextResponse.json({ error: "Escolha a conta (WABA) que vai submeter o template" }, { status: 400 });
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
  if (!credential) {
    return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });
  }

  const titulo = (body.titulo ?? "").trim();
  if (!titulo) return NextResponse.json({ error: "Falta o título do template" }, { status: 400 });

  const name = slugifyNomeTemplate(titulo);
  if (!name) {
    return NextResponse.json(
      { error: "O título precisa ter pelo menos uma letra ou número para virar o nome do template" },
      { status: 400 },
    );
  }

  const category = (body.category ?? "").toUpperCase();
  if (!["MARKETING", "UTILITY"].includes(category)) {
    return NextResponse.json({ error: "Categoria precisa ser Marketing ou Utility" }, { status: 400 });
  }

  const language = (body.language ?? "pt_BR").trim();

  // Botão de Flow: mesma validação de POST /api/campaigns (regra 37) — Flow
  // do mesmo tenant, mesmo número, ativo e publicado na Meta. Aqui é a
  // pessoa que MONTA o template quem escolhe, então a checagem acontece
  // antes de montar o payload, não só quando a campanha for criada depois.
  let botaoResolvido = body.botao ?? null;
  if (botaoResolvido?.modo === "flow") {
    if (!botaoResolvido.flowId) {
      return NextResponse.json({ error: "Escolha qual Flow o botão abre" }, { status: 400 });
    }
    const { data: flow } = await admin
      .from("whatsapp_flows")
      .select("id, tipo, ativo, meta_flow_id, cloud_credential_id, tenant_id, tela_inicial")
      .eq("id", botaoResolvido.flowId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!flow || flow.tenant_id !== operator.tenant_id) {
      return NextResponse.json({ error: "Flow não encontrado" }, { status: 400 });
    }
    if (flow.cloud_credential_id !== credential.id) {
      return NextResponse.json(
        { error: "O Flow escolhido é de outro número — abriria a central errada" },
        { status: 400 },
      );
    }
    if (!flow.ativo || !flow.meta_flow_id) {
      return NextResponse.json({ error: "O Flow escolhido não está ativo e publicado na Meta" }, { status: 400 });
    }
    if (!["central", "agenda_shows"].includes(flow.tipo)) {
      return NextResponse.json({ error: "Esse Flow não é do tipo que se abre numa conversa" }, { status: 400 });
    }

    // Mesma tela que o flow-engine abriria no INIT (index.ts,
    // telaInicialDaSessao): tela_inicial quando setada, senão o padrão do
    // tipo. O botão do template precisa cair no MESMO lugar.
    const navigateScreen = flow.tela_inicial ?? (flow.tipo === "central" ? "APRESENTACAO" : "AGENDA");
    botaoResolvido = { ...botaoResolvido, flowId: flow.meta_flow_id, navigateScreen };
  }

  const montagem = montarComponentes(
    {
      headerTexto: body.headerTexto ?? null,
      bodyTexto: body.bodyTexto ?? "",
      footerTexto: body.footerTexto ?? null,
      headerExemplo: body.headerExemplo ?? null,
      bodyExemplos: body.bodyExemplos ?? [],
      botao: botaoResolvido,
    },
    env.NEXT_PUBLIC_LINK_BASE_URL ?? null,
  );

  if (!montagem.ok) {
    return NextResponse.json({ error: montagem.erro }, { status: 400 });
  }

  try {
    const criado = await createMessageTemplate({
      wabaId: credential.waba_id,
      accessToken: credential.access_token,
      name,
      language,
      category: category as "MARKETING" | "UTILITY",
      components: montagem.components!,
    });

    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "template_criado",
      payload: { name, language, category, credentialId: credential.id, metaId: criado.id, status: criado.status },
    });

    return NextResponse.json({ ok: true, ...criado });
  } catch (err) {
    // Erro da Graph API repassado como veio (nome duplicado, exemplo
    // inválido, limite de criação/hora) — não vale reescrever uma mensagem
    // que muda mais rápido do que este código.
    // Um flow_id inválido/desativado do LADO DA META (não deveria acontecer
    // — validamos antes, acima) volta como "(#2) Service temporarily
    // unavailable", is_transient: true — texto que sugere "tente de novo" e
    // NÃO diz que o Flow é o problema. Confirmado reproduzindo de propósito
    // em 22/09/2026 (duas tentativas, mesmo erro as duas vezes). Repassado
    // como veio mesmo assim: reescrever a mensagem por cima de um erro raro
    // e nunca visto por um usuário de verdade (a validação acima cobre o
    // caminho normal) custaria mais do que vale.
    const mensagem = err instanceof GraphApiError ? err.message : "Falha ao criar template na Graph API";
    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "template_criado",
      payload: { name, language, category, credentialId: credential.id },
      error: mensagem,
    });
    return NextResponse.json({ error: mensagem }, { status: 502 });
  }
}
