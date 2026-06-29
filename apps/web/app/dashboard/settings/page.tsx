import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTenantOpenAIKey, mask } from "@/lib/ai";
import ProfileForm from "./profile-form";
import AiKeySection from "./ai-key-section";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: operator } = await supabase
    .from("operators")
    .select("name, role")
    .eq("id", user.id)
    .single();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, slug, plan")
    .single();

  const isAdmin = operator?.role === "admin";
  const { key, source } = await getTenantOpenAIKey(supabase);
  const hasOpenAI = !!key;
  // Nunca enviar a chave ao client — apenas o mascarado dos últimos 4
  const maskedKey = key ? mask(key) : null;

  const aiFeatures = [
    { name: "Transcrição de áudio (Whisper)", description: "Transcreve mensagens de voz automaticamente" },
    { name: "Busca semântica", description: "Busca por significado, não só palavras exatas" },
    { name: "Embeddings automáticos", description: "Gera embeddings das mensagens para busca semântica" },
  ];

  return (
    <div className="p-6 max-w-xl space-y-6 h-full overflow-y-auto">
      <h1 className="text-lg font-semibold text-white">Configurações</h1>

      {/* Tenant info */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">Empresa</h2>
        <div className="space-y-1 text-sm">
          <p className="text-gray-400">Nome: <span className="text-white">{tenant?.name}</span></p>
          <p className="text-gray-400">Slug: <span className="text-white">{tenant?.slug}</span></p>
          <p className="text-gray-400">Plano: <span className="text-white capitalize">{tenant?.plan}</span></p>
        </div>
      </div>

      {/* Profile form */}
      <ProfileForm
        initialName={operator?.name ?? ""}
        email={user.email ?? ""}
        role={operator?.role ?? "operator"}
      />

      {/* AI section */}
      {isAdmin ? (
        <AiKeySection hasKey={hasOpenAI} source={source} maskedKey={maskedKey} features={aiFeatures} />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300">Funcionalidades de IA</h2>
          <div className="space-y-2">
            {aiFeatures.map((f) => (
              <div key={f.name} className="flex items-start gap-3">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${hasOpenAI ? "bg-green-500" : "bg-gray-600"}`} />
                <div>
                  <p className={`text-sm ${hasOpenAI ? "text-white" : "text-gray-500"}`}>{f.name}</p>
                  <p className="text-xs text-gray-600">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
          {!hasOpenAI && (
            <p className="text-xs text-yellow-600 border-t border-gray-800 pt-3">
              IA não configurada. Peça ao administrador para ativá-la em Configurações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
