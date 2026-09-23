import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import AgendaManager from "./agenda-manager";
import AgendaFontes from "./agenda-fontes";

// Agenda de shows. Duas origens convivem na mesma tabela, de propósito (é o
// que o índice único parcial de show_id_origem preserva):
//   - sincronizada do board do Monday, pela ponte com o painel-shows
//     (PRD docs/prd/prd-agenda-via-painel-shows.md) — o sync só mexe no que
//     ele mesmo trouxe;
//   - digitada aqui, para o que não está no board.
//
// Admin e operator: mesmo par que administra automações (a agenda é conteúdo
// da automação, não credencial).

export default async function AgendaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (!operator || !["admin", "operator"].includes(operator.role)) redirect("/dashboard");

  // RLS filtra por tenant (regra 15).
  const { data: shows } = await supabase
    .from("agenda_shows_sync")
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, publicado, espetaculo, updated_at")
    .order("data_show", { ascending: true, nullsFirst: false });

  // Agendas sincronizadas (RLS acesso_por_numero filtra pelos números que
  // este operador enxerga).
  const { data: filtros } = await supabase
    .from("agenda_filtros")
    .select("id, cloud_credential_id, artista_origem, status_permitidos, espetaculos, janela_dias, ativo, ultima_sync_em, ultima_sync_resumo")
    .order("created_at", { ascending: true });

  // Artistas já conhecidos do tenant, para o campo não virar texto livre puro:
  // divergência de grafia ("Índio Behn" vs "Indio Behn") quebra o filtro que o
  // endpoint do Flow usa para montar a agenda.
  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, display_phone_number, phone_number_id, artista")
    .eq("tenant_id", operator.tenant_id);

  // Só a existência da conexão chega ao client — o token é deny-all e não sai
  // do servidor nem mascarado.
  const { data: conexao } = await admin
    .from("agenda_conexoes")
    .select("ativo")
    .eq("tenant_id", operator.tenant_id)
    .maybeSingle();

  const { data: flows } = await supabase
    .from("whatsapp_flows")
    .select("artista")
    .is("deleted_at", null)
    .not("artista", "is", null);

  const artistasSugeridos = Array.from(
    new Set([
      ...(credenciais ?? []).map((c) => c.artista as string),
      ...(flows ?? []).map((f) => f.artista as string),
    ]),
  ).filter(Boolean).sort();

  // Conteúdo dos espetáculos (arte e sinopse) que veio do board novo, e os
  // espetáculos de shows que NÃO casaram com nenhum tema — o casamento é por
  // nome, e sem essa lista um rename no board vira arte que desapareceu sem
  // explicação.
  const { data: temas } = await supabase
    .from("agenda_temas")
    .select("nome, artista_nome, sinopse, arte_asset_id, imagem_bytes, imagem_erro, imagem_atualizada_em")
    .order("nome");

  const chave = (t: string) =>
    t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const chavesComTema = new Set((temas ?? []).map((t) => chave(t.nome as string)));
  const espetaculosSemTema = Array.from(
    new Set(
      (shows ?? [])
        .map((s) => s.espetaculo as string | null)
        .filter((e): e is string => !!e && !chavesComTema.has(chave(e))),
    ),
  ).sort();

  const porCredencial = new Map((credenciais ?? []).map((c) => [c.id as string, c]));

  const filtrosComNumero = (filtros ?? []).map((f) => {
    const cred = porCredencial.get(f.cloud_credential_id as string);
    return {
      ...f,
      numero: (cred?.display_phone_number ?? cred?.phone_number_id ?? null) as string | null,
      artista_central: (cred?.artista ?? null) as string | null,
    };
  });

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white light:text-gray-900">Agenda de shows</h1>
        <p className="text-sm text-gray-400 mt-1 light:text-gray-600">
          É esta lista que o Flow de agenda responde no WhatsApp. Ela pode ser
          sincronizada do board de shows do Monday (abaixo) e também editada à mão —
          o sync só mexe nas linhas que ele mesmo trouxe.
        </p>
      </div>

      <AgendaFontes
        filtrosIniciais={filtrosComNumero}
        credenciais={(credenciais ?? []).map((c) => ({
          id: c.id as string,
          numero: (c.display_phone_number ?? c.phone_number_id) as string,
          artista: (c.artista ?? null) as string | null,
        }))}
        conexaoConfigurada={!!conexao}
        isAdmin={operator.role === "admin"}
        temas={(temas ?? []).map((t) => ({
          nome: t.nome as string,
          artista_nome: (t.artista_nome ?? null) as string | null,
          tem_sinopse: !!t.sinopse,
          tem_arte: !!t.arte_asset_id,
          imagem_bytes: (t.imagem_bytes ?? null) as number | null,
          imagem_erro: (t.imagem_erro ?? null) as string | null,
        }))}
        espetaculosSemTema={espetaculosSemTema}
      />

      <AgendaManager
        initial={shows ?? []}
        artistasSugeridos={artistasSugeridos}
        isAdmin={operator.role === "admin"}
        agoraIso={new Date().toISOString()}
      />
    </div>
  );
}
