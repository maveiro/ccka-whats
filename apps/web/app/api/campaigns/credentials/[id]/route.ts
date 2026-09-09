import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Editar um número Cloud API já cadastrado: rótulo, artista e ativo/inativo.
// O access_token NUNCA é editável por aqui nem devolvido — trocar token é
// recadastrar o número (POST /api/campaigns/credentials, que faz upsert em
// (tenant_id, phone_number_id) e verifica o token na Graph API antes de salvar).
//
// whatsapp_cloud_credentials é deny-all: toda leitura/escrita vai pelo admin
// client, com `.eq("tenant_id", ...)` explícito — exceção documentada à regra
// 15, igual ao resto do módulo de campanhas.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { label?: unknown; artista?: unknown; active?: unknown };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.label === "string") patch.label = body.label.trim() || null;
  if (typeof body.artista === "string") patch.artista = body.artista.trim() || null;
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Desativar um número com Flow ativo apagaria a automação da vista sem
  // avisar: o flow-engine resolve a credencial por `active = true` e passaria a
  // tratar as mensagens como "número sem credencial" (captura, não responde).
  if (patch.active === false) {
    const { count } = await admin
      .from("whatsapp_flows")
      .select("id", { count: "exact", head: true })
      .eq("cloud_credential_id", id)
      .eq("ativo", true)
      .is("deleted_at", null);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Existe automação ativa neste número. Desative o Flow antes de desativar o número." },
        { status: 409 },
      );
    }
  }

  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", operator.tenant_id)
    .select("id, waba_id, phone_number_id, display_phone_number, label, artista, active, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Número não encontrado" }, { status: 404 });

  // A caixa de entrada mostra o rótulo da sessão — manter em sincronia, senão
  // o número aparece com um nome na tela de Números e outro em Sessões.
  if (typeof patch.label === "string" || patch.label === null) {
    await admin
      .from("wa_sessions")
      .update({ label: (patch.label as string | null) ?? data.display_phone_number ?? data.phone_number_id })
      .eq("cloud_credential_id", id);
  }

  return NextResponse.json(data);
}
