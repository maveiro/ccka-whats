import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Agendas sincronizadas: uma linha = um número + o filtro do board que o
// alimenta (PRD docs/prd/prd-agenda-via-painel-shows.md, "Filtro por agenda").
//
// Autorização é da RLS (acesso_por_numero): quem não enxerga o número não
// enxerga a agenda dele. Client autenticado de propósito, sem
// `.eq("tenant_id")` redundante (regra 15) — o admin client entra só para ler
// whatsapp_cloud_credentials, que é deny-all.

interface Op {
  role: string;
  tenant_id: string;
}

async function autorizar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<Op>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return { erro: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { operator };
}

export async function GET() {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_filtros")
    .select("id, cloud_credential_id, artista_origem, status_permitidos, espetaculos, janela_dias, ativo, ultima_sync_em, ultima_sync_resumo, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Nome do número e do artista vêm da credencial (deny-all) — é o valor que
  // o endpoint do Flow usa para filtrar a lista do fã, e o que a tela precisa
  // mostrar para o admin conferir que a agenda vai para o artista certo.
  const admin = createAdminClient();
  const { data: creds } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, display_phone_number, phone_number_id, artista")
    .eq("tenant_id", auth.operator.tenant_id);

  const porId = new Map((creds ?? []).map((c) => [c.id, c]));

  return NextResponse.json((data ?? []).map((f) => {
    const cred = porId.get(f.cloud_credential_id);
    return {
      ...f,
      numero: cred?.display_phone_number ?? cred?.phone_number_id ?? null,
      artista_central: cred?.artista ?? null,
    };
  }));
}

export async function POST(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const body = await req.json() as Record<string, unknown>;
  const credentialId = typeof body.cloudCredentialId === "string" ? body.cloudCredentialId : "";
  const artistaOrigem = typeof body.artistaOrigem === "string" ? body.artistaOrigem.trim() : "";

  if (!credentialId || !artistaOrigem) {
    return NextResponse.json({ error: "Número e artista no board são obrigatórios" }, { status: 400 });
  }

  // Sem artista no número, o endpoint do Flow serve a agenda inteira do
  // tenant — a agenda de um artista apareceria na central de outro. A função
  // do banco também recusa; barrar aqui é o que dá mensagem acionável antes
  // de alguém esperar a primeira sincronização para descobrir.
  const admin = createAdminClient();
  const { data: cred } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, artista")
    .eq("tenant_id", auth.operator.tenant_id)
    .eq("id", credentialId)
    .maybeSingle<{ id: string; artista: string | null }>();

  if (!cred) return NextResponse.json({ error: "Número não encontrado" }, { status: 404 });
  if (!cred.artista?.trim()) {
    return NextResponse.json(
      { error: "Defina o artista deste número em Números antes de criar a agenda" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_filtros")
    .insert({
      tenant_id: auth.operator.tenant_id,
      cloud_credential_id: credentialId,
      artista_origem: artistaOrigem,
      ...(Array.isArray(body.statusPermitidos) && body.statusPermitidos.length > 0
        ? { status_permitidos: body.statusPermitidos as string[] }
        : {}),
      espetaculos: Array.isArray(body.espetaculos) && body.espetaculos.length > 0
        ? body.espetaculos as string[]
        : null,
      janela_dias: typeof body.janelaDias === "number" && body.janelaDias > 0 ? body.janelaDias : null,
    })
    .select("id")
    .single();

  if (error) {
    // unique (tenant_id, artista_origem): duas agendas do mesmo artista de
    // origem brigariam pela mesma linha de agenda_shows_sync.
    const conflito = error.code === "23505";
    return NextResponse.json(
      { error: conflito ? "Já existe uma agenda para este artista do board" : error.message },
      { status: conflito ? 409 : 500 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
