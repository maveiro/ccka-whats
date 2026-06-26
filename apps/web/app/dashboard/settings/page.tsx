import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import ProfileForm from "./profile-form";

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

  const hasOpenAI = !!env.OPENAI_API_KEY;

  const aiFeatures = [
    {
      name: "Transcrição de áudio (Whisper)",
      description: "Transcreve mensagens de voz automaticamente",
      enabled: hasOpenAI,
    },
    {
      name: "Busca semântica",
      description: "Busca por significado, não só palavras exatas",
      enabled: hasOpenAI,
    },
    {
      name: "Embeddings automáticos",
      description: "Gera embeddings das mensagens para busca semântica",
      enabled: hasOpenAI,
    },
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

      {/* AI features status */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-gray-300">Funcionalidades de IA</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Requerem <code className="bg-gray-800 px-1 rounded text-gray-300">OPENAI_API_KEY</code> configurada nos Supabase Secrets.
          </p>
        </div>
        <div className="space-y-2">
          {aiFeatures.map((f) => (
            <div key={f.name} className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  f.enabled ? "bg-green-500" : "bg-gray-600"
                }`}
              />
              <div>
                <p className={`text-sm ${f.enabled ? "text-white" : "text-gray-500"}`}>{f.name}</p>
                <p className="text-xs text-gray-600">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
        {!hasOpenAI && (
          <p className="text-xs text-yellow-600 border-t border-gray-800 pt-3">
            Configure <code className="bg-gray-800 px-1 rounded">OPENAI_API_KEY</code> no painel do Supabase → Edge Functions → Secrets para ativar essas funcionalidades.
          </p>
        )}
      </div>
    </div>
  );
}
