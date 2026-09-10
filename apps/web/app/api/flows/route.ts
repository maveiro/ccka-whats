import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// CRUD de Flows (automação por palavra-chave). Sprint A2 do PRD
// docs/prd/prd-automacao-flows-whatsapp.md.
//
// Acesso: admin e operator criam/editam (decisão fechada do PRD); exclusão é
// admin-only, por simetria com sessões (regra 21 do CLAUDE.md). Quem aplica
// isso é a RLS da migration 0025 (has_cloud_credential_access) — as queries
// abaixo usam o client AUTENTICADO de propósito, sem `.eq("tenant_id", ...)`
// redundante (regra 15). O admin client só entra para ler
// whatsapp_cloud_credentials, que é deny-all.

interface OperatorRow {
  role: string;
  tenant_id: string;
}

async function autorizar(): Promise<
  | { erro: NextResponse }
  | { operator: OperatorRow; userId: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<OperatorRow>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { operator, userId: user.id };
}

export async function GET() {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_flows")
    .select("id, cloud_credential_id, artista, nome, tipo, ativo, meta_flow_id, mensagem_convite, mensagem_boas_vindas, mensagem_fallback, created_at, flow_palavras_chave!flow_palavras_chave_flow_id_fkey(id, palavra_chave, tipo_resposta, resposta, flow_destino_id, deleted_at)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keywords soft-deletadas não voltam pro client (o embed do PostgREST não
  // aceita filtro na relação junto com `is null` no pai sem virar inner join).
  const flows = (data ?? []).map((f) => ({
    ...f,
    flow_palavras_chave: (f.flow_palavras_chave ?? []).filter(
      (k: { deleted_at: string | null }) => k.deleted_at === null,
    ),
  }));

  return NextResponse.json(flows);
}

export async function POST(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;
  const { operator } = auth;

  const body = await req.json() as {
    cloudCredentialId?: unknown;
    nome?: unknown;
    artista?: unknown;
    mensagemBoasVindas?: unknown;
    mensagemFallback?: unknown;
  };

  const cloudCredentialId = typeof body.cloudCredentialId === "string" ? body.cloudCredentialId.trim() : "";
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";

  if (!cloudCredentialId || !nome) {
    return NextResponse.json({ error: "Número e nome do Flow são obrigatórios" }, { status: 400 });
  }

  // A credencial precisa ser do tenant de quem pede. A tabela é deny-all, então
  // a RLS não faz essa checagem sozinha aqui — sem isto, um admin poderia
  // ancorar um Flow no número de outro tenant (a policy de whatsapp_flows
  // barraria o insert, mas com erro obscuro em vez de mensagem clara).
  const admin = createAdminClient();
  const { data: credencial } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id")
    .eq("id", cloudCredentialId)
    .eq("tenant_id", operator.tenant_id)
    .eq("active", true)
    .maybeSingle();

  if (!credencial) {
    return NextResponse.json({ error: "Número não encontrado neste tenant" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_flows")
    .insert({
      tenant_id: operator.tenant_id,
      cloud_credential_id: cloudCredentialId,
      nome,
      // Só keyword_automation nesta entrega: agenda_shows depende da Trilha B
      // (endpoint criptografado do WhatsApp Flow). O schema já aceita os dois.
      tipo: "keyword_automation",
      artista: typeof body.artista === "string" && body.artista.trim() ? body.artista.trim() : null,
      mensagem_boas_vindas: typeof body.mensagemBoasVindas === "string" && body.mensagemBoasVindas.trim()
        ? body.mensagemBoasVindas.trim()
        : null,
      mensagem_fallback: typeof body.mensagemFallback === "string" && body.mensagemFallback.trim()
        ? body.mensagemFallback.trim()
        : null,
      // Nasce INATIVO: um Flow ativo começa a responder de verdade assim que a
      // próxima mensagem chega, e criar já respondendo (sem keyword nenhuma
      // cadastrada) mandaria fallback para todo mundo.
      ativo: false,
    })
    .select("id, cloud_credential_id, artista, nome, tipo, ativo, meta_flow_id, mensagem_convite, mensagem_boas_vindas, mensagem_fallback, created_at")
    .single();

  if (error) {
    // 23505 = unique_violation: já existe Flow ativo desse tipo no número.
    const status = error.code === "23505" ? 409 : 500;
    const mensagem = error.code === "23505"
      ? "Já existe um Flow ativo deste tipo para este número"
      : error.message;
    return NextResponse.json({ error: mensagem }, { status });
  }

  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "flow_criado",
    payload: { flowId: data.id, nome, cloudCredentialId },
  });

  return NextResponse.json({ ...data, flow_palavras_chave: [] }, { status: 201 });
}
