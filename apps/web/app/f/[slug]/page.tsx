import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import FormularioPublico from "./formulario-publico";

// Página pública do formulário, feita para ser embutida por <iframe>.
//
// Fora do /dashboard de propósito: não passa pelo proxy de autenticação e não
// carrega o layout do painel. É a única página do app que qualquer pessoa
// abre.

export default async function FormularioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Sem sessão de usuário aqui — a leitura é pelo admin client, restrita ao
  // que é público por natureza (nada de tenant_id ou contagens na resposta).
  const admin = createAdminClient();
  const { data: form } = await admin
    .from("formularios_cadastro")
    .select("slug, titulo, descricao, texto_consentimento, mensagem_sucesso, exige_nome, exige_email, ativo")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (!form || !form.ativo) notFound();

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-start justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold">{form.titulo}</h1>
        {form.descricao && <p className="text-sm text-gray-400 mt-1">{form.descricao}</p>}
        <FormularioPublico
          slug={form.slug}
          textoConsentimento={form.texto_consentimento}
          mensagemSucesso={form.mensagem_sucesso}
          exigeNome={form.exige_nome}
          exigeEmail={form.exige_email}
        />
      </div>
    </main>
  );
}
