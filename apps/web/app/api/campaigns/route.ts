import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

interface RecipientInput {
  phone: string;
  variables?: Record<string, unknown>;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, template_name, template_category, status, total_recipients, sent_count, delivered_count, read_count, failed_count, clicked_count, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Custo do ledger (migration custos_cloud_api), numa chamada só para a
  // lista inteira — não uma por campanha.
  const { data: costs } = await supabase.rpc("campaign_costs");
  const porCampanha = new Map(
    (costs as { campaign_id: string; cost: number }[] | null ?? []).map((c) => [c.campaign_id, Number(c.cost)]),
  );

  return NextResponse.json((data ?? []).map((c) => ({ ...c, cost: porCampanha.get(c.id) ?? 0 })));
}


/**
 * Quantos parâmetros o template espera, e onde.
 *
 * Espelha `planoDeVariaveis` em supabase/functions/campaign-sender/variaveis.ts
 * — Edge Function (Deno) e painel (Next) não compartilham módulo. As duas
 * cópias precisam concordar: é esta que recusa a campanha, e é a de lá que
 * monta o envio.
 */
function planoDeVariaveis(componentes: unknown): { header: number; body: number; headerMidia: string | null } {
  const plano = { header: 0, body: 0, headerMidia: null as string | null };
  if (!Array.isArray(componentes)) return plano;

  const conta = (texto: unknown) => {
    if (typeof texto !== "string") return 0;
    const achados = texto.match(/\{\{\s*\d+\s*\}\}/g);
    return achados ? new Set(achados.map((m) => m.replace(/\s/g, ""))).size : 0;
  };

  for (const c of componentes) {
    const comp = c as { type?: string; format?: string; text?: string };
    const tipo = comp?.type?.toUpperCase();
    if (tipo === "HEADER") {
      const formato = comp.format?.toUpperCase() ?? "TEXT";
      if (formato === "TEXT") plano.header = conta(comp.text);
      else plano.headerMidia = formato;
    }
    if (tipo === "BODY") plano.body = conta(comp.text);
  }

  return plano;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    campaignId?: unknown; // se presente: adiciona/atualiza destinatários numa campanha draft existente
    name?: unknown;
    credentialId?: unknown;
    templateName?: unknown;
    templateLanguage?: unknown;
    templateCategory?: unknown;
    templateComponents?: unknown;
    clickTargetUrl?: unknown;
    flowId?: unknown;
    recipients?: unknown;
  };

  const recipientsInput = Array.isArray(body.recipients) ? (body.recipients as RecipientInput[]) : [];
  const filteredByFormat = recipientsInput.filter(
    (r) => r && typeof r.phone === "string" && /^\d{10,15}$/.test(r.phone),
  );

  // Dedupe por telefone — obrigatório antes do upsert em lote abaixo:
  // "ON CONFLICT DO UPDATE" do Postgres não aceita a mesma chave de
  // conflito duas vezes DENTRO do mesmo INSERT (erro real visto em
  // produção com uma base de 1910 linhas com números repetidos). Mantém a
  // última ocorrência — CSV mais recente da mesma pessoa vence.
  const dedupedByPhone = new Map(filteredByFormat.map((r) => [r.phone, r]));
  const validRecipients = Array.from(dedupedByPhone.values());
  const duplicateCount = filteredByFormat.length - validRecipients.length;

  if (validRecipients.length === 0) {
    return NextResponse.json({ error: "Nenhum destinatário válido (telefone em E.164 sem '+', ex: 5541999999999)" }, { status: 400 });
  }

  const admin = createAdminClient();
  let campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

  if (!campaignId) {
    if (
      typeof body.name !== "string" || !body.name.trim() ||
      typeof body.credentialId !== "string" ||
      typeof body.templateName !== "string" ||
      typeof body.templateLanguage !== "string"
    ) {
      return NextResponse.json({ error: "name, credentialId, templateName e templateLanguage são obrigatórios" }, { status: 400 });
    }

    // Botão de Flow (Sprint C4): a campanha precisa dizer QUAL central o
    // botão abre — é de onde saem o flow_id e a credencial da sessão que
    // identifica cada pessoa dentro do Flow (regra 28). Barrar aqui, e não
    // só no campaign-sender, é o que dá mensagem de erro para quem está
    // montando a campanha; enviar sem token não falha, só faz a base
    // inteira abrir a central como desconhecida.
    // Quantidade de variáveis: o CSV tem que trazer exatamente o que o
    // template pede, CABEÇALHO + CORPO. Barrar aqui é o que transforma um
    // "(#132000) Number of parameters does not match" — que só aparece
    // depois, no erro de cada destinatário, com a campanha já criada e
    // 100% de falha — em uma frase antes de existir base para disparar
    // (18/09/2026).
    const plano = planoDeVariaveis(body.templateComponents);
    if (plano.headerMidia) {
      return NextResponse.json(
        {
          error:
            `O template "${body.templateName}" tem cabeçalho de ${plano.headerMidia}, que ainda não ` +
            `sabemos preencher — a Meta recusaria todos os envios. Use um template com cabeçalho em texto.`,
        },
        { status: 400 },
      );
    }

    const esperadas = plano.header + plano.body;
    const recebidas = recipientsInput.reduce(
      (max, r) => Math.max(max, Object.keys((r?.variables ?? {}) as Record<string, unknown>).length),
      0,
    );
    if (recebidas !== esperadas) {
      const onde = plano.header > 0
        ? ` (${plano.header} no cabeçalho e ${plano.body} no corpo, nesta ordem)`
        : "";
      return NextResponse.json(
        {
          error:
            `O template "${body.templateName}" espera ${esperadas} variável(is)${onde}, ` +
            `mas o CSV trouxe ${recebidas}. A Meta recusaria todos os envios.`,
        },
        { status: 400 },
      );
    }

    const flowButton = findFlowButton(body.templateComponents);
    const flowId = typeof body.flowId === "string" && body.flowId ? body.flowId : null;

    if (flowButton && !flowId) {
      return NextResponse.json(
        { error: "Este template tem botão de Flow — escolha qual central ele abre" },
        { status: 400 },
      );
    }
    if (flowId && !flowButton) {
      return NextResponse.json(
        { error: "O template escolhido não tem botão de Flow, então não há central para abrir" },
        { status: 400 },
      );
    }

    if (flowId) {
      // Client autenticado de propósito (regra 15): a RLS da 0025 já limita
      // a Flows do tenant e dos números que este operador enxerga.
      const { data: flow } = await supabase
        .from("whatsapp_flows")
        .select("id, nome, tipo, ativo, meta_flow_id, cloud_credential_id")
        .eq("id", flowId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!flow || !flow.ativo) {
        return NextResponse.json({ error: "Flow não encontrado ou inativo" }, { status: 400 });
      }
      if (flow.cloud_credential_id !== body.credentialId) {
        return NextResponse.json(
          { error: "O Flow escolhido pertence a outro número — a central aberta seria de outro artista" },
          { status: 400 },
        );
      }
      if (!flow.meta_flow_id) {
        return NextResponse.json(
          { error: `O Flow "${flow.nome}" ainda não foi publicado na Meta` },
          { status: 400 },
        );
      }
      // O Flow da Meta está congelado no botão do template; se apontar para
      // outro, o fã abre uma central e a sessão diz outra.
      if (flowButton?.flow_id && flowButton.flow_id !== flow.meta_flow_id) {
        return NextResponse.json(
          { error: `O botão deste template abre o Flow ${flowButton.flow_id} na Meta, que não é o "${flow.nome}"` },
          { status: 400 },
        );
      }
    }

    const { data: newCampaign, error: createError } = await admin
      .from("campaigns")
      .insert({
        tenant_id: operator.tenant_id,
        credential_id: body.credentialId,
        created_by: user.id,
        name: body.name.trim(),
        template_name: body.templateName,
        template_language: body.templateLanguage,
        template_category: typeof body.templateCategory === "string" ? body.templateCategory : null,
        template_components: body.templateComponents ?? null,
        // Destino real do botão rastreado (migration campanhas_clique_rastreado).
        // O template aponta para /c/{{1}} e é daqui que o redirect descobre
        // para onde mandar.
        click_target_url: typeof body.clickTargetUrl === "string" && body.clickTargetUrl.trim()
          ? body.clickTargetUrl.trim()
          : null,
        flow_id: flowId,
        status: "draft",
      })
      .select("id")
      .single();

    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
    campaignId = newCampaign.id;

    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "campaign_created",
      payload: { campaignId, templateName: body.templateName },
    });
  } else {
    // Confirmar que a campanha pertence ao tenant e ainda está em draft
    // (não permitir reupload de base depois que já começou a enviar).
    const { data: existing } = await admin
      .from("campaigns")
      .select("id, tenant_id, status")
      .eq("id", campaignId)
      .single();

    if (!existing || existing.tenant_id !== operator.tenant_id) {
      return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "Só é possível adicionar destinatários a campanhas em rascunho" }, { status: 409 });
    }
  }

  // Filtrar opt-outs antes de inserir.
  const { data: optOuts } = await admin
    .from("whatsapp_opt_outs")
    .select("phone_e164")
    .eq("tenant_id", operator.tenant_id)
    .in("phone_e164", validRecipients.map((r) => r.phone));

  const optOutSet = new Set((optOuts ?? []).map((o) => o.phone_e164));
  const filteredRecipients = validRecipients.filter((r) => !optOutSet.has(r.phone));

  // Upsert que NUNCA toca status/wamid/attempts/sent_at no conflito — reupload
  // de CSV não pode voltar quem já foi sent/delivered para pending.
  const rows = filteredRecipients.map((r) => ({
    campaign_id: campaignId,
    tenant_id: operator.tenant_id,
    phone_e164: r.phone,
    variables: r.variables ?? {},
  }));

  const { error: upsertError } = await admin
    .from("campaign_recipients")
    .upsert(rows, { onConflict: "campaign_id,phone_e164", ignoreDuplicates: false })
    .select("id");

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  const { count } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  await admin
    .from("campaigns")
    .update({ total_recipients: count ?? 0, status: "ready", updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "draft"); // não regride uma campanha que já não está mais em draft

  return NextResponse.json({
    campaignId,
    accepted: filteredRecipients.length,
    skippedOptOut: validRecipients.length - filteredRecipients.length,
    skippedInvalid: recipientsInput.length - filteredByFormat.length,
    skippedDuplicate: duplicateCount,
    total: count ?? 0,
  }, { status: 201 });
}

interface TemplateButton {
  type?: string;
  flow_id?: string;
}

/**
 * Botão de FLOW do template, se houver. Espelha findFlowButton do
 * campaign-sender — as duas funções não podem divergir, mas Route Handler
 * (Next) e Edge Function (Deno) não compartilham módulo.
 */
function findFlowButton(templateComponents: unknown): { flow_id?: string } | null {
  if (!Array.isArray(templateComponents)) return null;

  for (const component of templateComponents) {
    const buttons = (component as { buttons?: TemplateButton[] })?.buttons;
    if (!Array.isArray(buttons)) continue;
    const found = buttons.find((b) => b?.type?.toUpperCase() === "FLOW");
    if (found) return { flow_id: found.flow_id };
  }

  return null;
}
