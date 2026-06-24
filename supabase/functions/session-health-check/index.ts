import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Buscar todas as sessões que não estão banidas
  const { data: sessions, error } = await supabase
    .from("wa_sessions")
    .select("id, tenant_id, evolution_instance_name, status")
    .neq("status", "banned")
    .not("evolution_instance_name", "is", null);

  if (error) {
    console.error("Failed to fetch sessions:", error);
    return new Response("Database error", { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return new Response("No active sessions", { status: 200 });
  }

  // Verificar cada sessão em paralelo
  await Promise.allSettled(sessions.map(checkSession));

  return new Response("ok", { status: 200 });
});

async function checkSession(session: {
  id: string;
  tenant_id: string;
  evolution_instance_name: string;
  status: string;
}): Promise<void> {
  const { id: sessionId, tenant_id: tenantId, evolution_instance_name: instanceName, status: currentStatus } = session;

  let newStatus: string;

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
      {
        headers: { "apikey": EVOLUTION_API_KEY },
      },
    );

    if (res.status === 404) {
      // Instância não existe mais no Evolution
      newStatus = "disconnected";
    } else if (!res.ok) {
      console.error(`Evolution API error for ${instanceName}: ${res.status}`);
      return;
    } else {
      const body = await res.json() as Record<string, unknown>;
      const state = (body.instance as Record<string, unknown>)?.state as string ?? "close";

      const stateMap: Record<string, string> = {
        open: "connected",
        close: "disconnected",
        connecting: "connecting",
      };

      newStatus = stateMap[state] ?? "disconnected";
    }
  } catch (err) {
    console.error(`Failed to reach Evolution for ${instanceName}:`, err);
    return;
  }

  // Só atualizar se o status mudou
  if (newStatus === currentStatus) {
    // Apenas atualizar last_seen_at se conectado
    if (newStatus === "connected") {
      await supabase
        .from("wa_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
    return;
  }

  await supabase
    .from("wa_sessions")
    .update({ status: newStatus, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);

  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    event_type: "session_status_changed",
    payload: { from: currentStatus, to: newStatus, instance: instanceName },
  });
}
