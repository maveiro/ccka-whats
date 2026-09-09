import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClientesBusca from "./clientes-busca";

// Atendimento a pedido de exclusão de dados (LGPD). Admin-only, e sem
// listagem: a tela só mostra quem for encontrado por telefone. Um pedido de
// exclusão sempre parte de um telefone conhecido, e listar a base inteira
// exporia PII sem necessidade — a decisão do PRD é que nem o operator tem
// visão geral de `clientes`.

export default async function ClientesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Dados de clientes (LGPD)</h1>
        <p className="text-sm text-gray-400 mt-1">
          Busque pelo telefone para atender a um pedido de exclusão de dados pessoais.
          A exclusão apaga nome, e-mail e mensagens pendentes de forma definitiva; o
          telefone permanece, porque é o que liga a conversa ao histórico de mensagens.
        </p>
      </div>
      <ClientesBusca />
    </div>
  );
}
