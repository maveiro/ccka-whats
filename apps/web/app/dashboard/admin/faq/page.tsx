import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import FaqManager from "./faq-manager";

// FAQ da Central de Shows. Admin e operator, mesmo par que administra Flows e
// agenda — FAQ é conteúdo da automação, não credencial.
//
// O conteúdo vem do banco de propósito: Flow publicado na Meta é imutável, e
// FAQ dentro do JSON obrigaria a republicar a cada correção de texto.

export default async function FaqPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators").select("role, tenant_id").eq("id", user!.id).single();

  if (!operator || !["admin", "operator"].includes(operator.role)) redirect("/dashboard");

  const { data: itens } = await supabase
    .from("faq_itens")
    .select("id, artista, pergunta, resposta, ordem, ativo, updated_at")
    .is("deleted_at", null)
    .order("ordem", { ascending: true });

  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("artista")
    .eq("tenant_id", operator.tenant_id)
    .not("artista", "is", null);

  const artistas = Array.from(new Set((credenciais ?? []).map((c) => c.artista as string))).sort();

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Perguntas frequentes</h1>
        <p className="text-sm text-gray-400 mt-1">
          É este conteúdo que a Central de Shows responde no WhatsApp. Editar aqui
          reflete na hora — não é preciso republicar o Flow na Meta. Pergunta sem
          artista vale para todos os números do tenant.
        </p>
      </div>
      <FaqManager
        initial={itens ?? []}
        artistas={artistas}
        isAdmin={operator.role === "admin"}
      />
    </div>
  );
}
