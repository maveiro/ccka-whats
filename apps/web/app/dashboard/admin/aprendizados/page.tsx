import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LearningsList from "./learnings-list";

export default async function AprendizadosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (!operator) redirect("/dashboard");

  const { data: learnings } = await supabase
    .from("learnings")
    .select("id, title, description, category, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Aprendizados</h1>
        <p className="text-sm text-gray-400 mt-1">
          Registro de bugs reais, decisões e comportamentos externos (Meta/Graph API etc.)
          encontrados operando a plataforma — pra não redescobrir o mesmo problema duas vezes.
        </p>
      </div>

      <LearningsList initial={learnings ?? []} />
    </div>
  );
}
