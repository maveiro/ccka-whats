import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

interface DeliveryRequest {
  tenantId: string
  event: string
  payload: unknown
}

interface WebhookConfig {
  url: string
  secret?: string
}

interface Integration {
  id: string
  config: WebhookConfig
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  let body: DeliveryRequest
  try {
    body = await req.json() as DeliveryRequest
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 })
  }

  const { tenantId, event, payload } = body
  if (!tenantId || !event) {
    return new Response(JSON.stringify({ error: "tenantId and event are required" }), { status: 400 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("id, config")
    .eq("tenant_id", tenantId)
    .eq("type", "webhook")
    .eq("active", true)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const webhooks = (integrations ?? []) as Integration[]
  const timestamp = new Date().toISOString()

  const results = await Promise.all(
    webhooks.map(async (integration) => {
      const cfg = integration.config
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (cfg.secret) headers["X-Webhook-Secret"] = cfg.secret

      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, payload, timestamp }),
        })

        await supabase.from("events_log").insert({
          tenant_id: tenantId,
          type: "webhook_delivery",
          status: res.ok ? "success" : "error",
          payload: { integration_id: integration.id, event, status_code: res.status },
        })

        return { success: res.ok }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await supabase.from("events_log").insert({
          tenant_id: tenantId,
          type: "webhook_delivery",
          status: "error",
          payload: { integration_id: integration.id, event, error: errMsg },
        })
        return { success: false }
      }
    })
  )

  const delivered = results.filter(r => r.success).length
  const failed = results.length - delivered

  return new Response(JSON.stringify({ delivered, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
