import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CostsDashboard from "./costs-dashboard";

// Aba de Custos — gasto da WhatsApp Cloud API por disparo, campanha e número.
// Cobre os TRÊS caminhos de envio oficial do produto (campanha, resposta
// automática de Flow e envio manual do painel), não só campanha: a partir de
// 01/10/2026 mensagem de serviço passa a ser cobrada, e é justamente o
// caminho do Flow que vira custo.

export default async function CostsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  // Números para o filtro — RLS já limita ao tenant (regra 15).
  const { data: sessions } = await supabase
    .from("wa_sessions")
    .select("id, label, phone_number, channel")
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-white mb-1">Custos</h1>
      <p className="text-sm text-gray-400 mb-6">
        Gasto com a WhatsApp Cloud API oficial. O que a Meta cobra por mensagem
        vem do webhook de entrega; o valor em reais vem do rate card cadastrado.
      </p>
      <CostsDashboard sessions={sessions ?? []} />
    </div>
  );
}
