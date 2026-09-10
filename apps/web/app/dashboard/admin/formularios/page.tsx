import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import FormulariosManager from "./formularios-manager";

// Formulários de cadastro embutíveis. Admin-only: aqui se define o texto legal
// que terceiros vão ler e a versão que fica gravada em cada consentimento.

export default async function FormulariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators").select("role, tenant_id").eq("id", user!.id).single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: formularios } = await supabase
    .from("formularios_cadastro")
    .select("id, slug, nome, artista, titulo, descricao, texto_consentimento, versao_consentimento, mensagem_sucesso, exige_nome, exige_email, dominios_permitidos, ativo, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("artista")
    .eq("tenant_id", operator.tenant_id)
    .not("artista", "is", null);

  const artistas = Array.from(new Set((credenciais ?? []).map((c) => c.artista as string))).sort();

  // A URL de embed precisa ser a real (o site de terceiros não conhece
  // caminhos relativos nossos), e ela muda entre local e produção.
  const h = await headers();
  const origem = `https://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Formulários de cadastro</h1>
        <p className="text-sm text-gray-400 mt-1">
          Cada formulário pode ser embutido em qualquer site por iframe, ou usado como
          endpoint se você preferir montar o visual na sua própria página. O texto de
          consentimento fica gravado com a versão em cada cadastro que entrar por ele.
        </p>
      </div>

      <FormulariosManager
        initial={formularios ?? []}
        artistas={artistas}
        origem={origem}
      />
    </div>
  );
}
