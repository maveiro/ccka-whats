import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InviteOperatorForm from "./invite-form";
import OperatorActions from "./operator-actions";

export default async function OperatorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: operators } = await supabase
    .from("operators")
    .select("id, name, email, role, active, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Operadores</h1>
        <p className="text-sm text-gray-400 mt-1">
          Gerencie quem tem acesso à plataforma.
        </p>
      </div>

      <div className="space-y-2">
        {(operators ?? []).map((op) => (
          <div
            key={op.id}
            className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium text-white">{op.name ?? op.email}</p>
              <p className="text-xs text-gray-500">{op.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  op.role === "admin"
                    ? "border-green-700 text-green-400"
                    : "border-gray-700 text-gray-400"
                }`}
              >
                {op.role}
              </span>
              {!op.active && (
                <span className="text-xs text-red-400">inativo</span>
              )}
              <OperatorActions operator={op} currentUserId={user!.id} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-white mb-3">Convidar operador</h2>
        <InviteOperatorForm tenantId={operator.tenant_id} />
      </div>
    </div>
  );
}
