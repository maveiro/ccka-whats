import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InviteOperatorForm from "./invite-form";
import OperatorActions from "./operator-actions";
import OperatorSessionAccess from "./operator-session-access";

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
    .select("id, name, email, role, active, created_at, session_scope")
    .order("created_at", { ascending: true });

  const { data: sessions } = await supabase
    .from("wa_sessions")
    .select("id, label, phone_number")
    .order("created_at", { ascending: true });

  const { data: grants } = await supabase
    .from("operator_session_access")
    .select("operator_id, session_id");

  const grantsByOperator = new Map<string, string[]>();
  for (const g of grants ?? []) {
    grantsByOperator.set(g.operator_id, [...(grantsByOperator.get(g.operator_id) ?? []), g.session_id]);
  }

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
            className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3"
          >
            <div className="flex items-center justify-between">
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
            {op.role === "operator" && (
              <OperatorSessionAccess
                operatorId={op.id}
                sessions={sessions ?? []}
                initialScope={(op.session_scope as "all" | "restricted") ?? "all"}
                initialSessionIds={grantsByOperator.get(op.id) ?? []}
              />
            )}
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
