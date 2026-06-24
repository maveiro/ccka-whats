import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, slug, plan")
    .single();

  return (
    <div className="p-6 max-w-xl space-y-6">
      <h1 className="text-lg font-semibold text-white">Configurações</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-gray-300">Tenant</h2>
        <div className="space-y-1 text-sm">
          <p className="text-gray-400">Nome: <span className="text-white">{tenant?.name}</span></p>
          <p className="text-gray-400">Slug: <span className="text-white">{tenant?.slug}</span></p>
          <p className="text-gray-400">Plano: <span className="text-white capitalize">{tenant?.plan}</span></p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-gray-300">Conta</h2>
        <p className="text-sm text-gray-400">Email: <span className="text-white">{user?.email}</span></p>
      </div>
    </div>
  );
}
