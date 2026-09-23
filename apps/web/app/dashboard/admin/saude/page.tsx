import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SaudeManager from "./saude-manager";

// Saúde do sistema: o que falhou, agrupado por assinatura.
//
// Existe porque o projeto grava em events_log com disciplina e nunca lia. Em
// 12–14/09/2026 um surto de 86 timeouts passou sem ninguém saber, e duas
// falhas silenciosas da ponte da agenda só apareceram numa revisão manual.

export default async function SaudePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators").select("role").eq("id", user!.id).single();
  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: erros } = await supabase.rpc("resumo_de_erros", { p_horas: 24 });

  // Integrações de webhook ativas: é por elas que o aviso de hora em hora
  // sai. Sem nenhuma, a vigilância vira só esta tela.
  const { count: webhooks } = await supabase
    .from("integrations")
    .select("id", { count: "exact", head: true })
    .eq("type", "webhook")
    .eq("active", true);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white light:text-gray-900">Saúde</h1>
        <p className="text-sm text-gray-400 mt-1 light:text-gray-600">
          Erros agrupados por assinatura — 57 ocorrências do mesmo problema viram
          uma linha. De hora em hora, assinatura nova ou volume acima de 20 no dia
          dispara aviso pelas integrações de webhook.
        </p>
      </div>

      <SaudeManager iniciais={erros ?? []} temWebhook={(webhooks ?? 0) > 0} />
    </div>
  );
}
