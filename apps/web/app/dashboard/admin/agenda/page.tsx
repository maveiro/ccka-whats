import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import AgendaManager from "./agenda-manager";

// Agenda de shows — V1 do PRD: preenchida à mão aqui. Na V2 a mesma tabela
// passa a ser espelho do painel-shows (job de sincronização), sem mudar o
// endpoint do Flow que a lê.
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
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, updated_at")
    .order("data_show", { ascending: true, nullsFirst: false });

  // Artistas já conhecidos do tenant, para o campo não virar texto livre puro:
  // divergência de grafia ("Índio Behn" vs "Indio Behn") quebra o filtro que o
  // endpoint do Flow usa para montar a agenda.
  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("artista")
    .eq("tenant_id", operator.tenant_id)
    .not("artista", "is", null);

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

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Agenda de shows</h1>
        <p className="text-sm text-gray-400 mt-1">
          É esta lista que o Flow de agenda responde no WhatsApp. Preenchimento manual
          nesta versão — quando a integração com o painel-shows entrar, ela passa a ser
          sincronizada automaticamente e esta tela vira consulta.
        </p>
      </div>

      <AgendaManager
        initial={shows ?? []}
        artistasSugeridos={artistasSugeridos}
        isAdmin={operator.role === "admin"}
        agoraIso={new Date().toISOString()}
      />
    </div>
  );
}
