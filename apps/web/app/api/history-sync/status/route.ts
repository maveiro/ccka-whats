import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const since = searchParams.get("since");

  if (!sessionId || !since) {
    return NextResponse.json({ error: "sessionId and since are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: events } = await admin
    .from("events_log")
    .select("event_type, payload, error, created_at")
    .eq("session_id", sessionId)
    .gte("created_at", since)
    .in("event_type", ["webhook_received", "error"])
    .order("created_at", { ascending: false })
    .limit(20);

  const syncEvents = (events ?? []).filter(
    (e) =>
      e.event_type === "error" ||
      (e.payload as Record<string, unknown>)?.type === "history_sync_completed" ||
      (e.payload as Record<string, unknown>)?.type === "history_sync_started",
  );

  const completed = syncEvents.find(
    (e) => (e.payload as Record<string, unknown>)?.type === "history_sync_completed",
  );
  const started = syncEvents.find(
    (e) => (e.payload as Record<string, unknown>)?.type === "history_sync_started",
  );
  const errors = syncEvents.filter((e) => e.event_type === "error");

  return NextResponse.json({
    status: completed ? "completed" : started ? "running" : "pending",
    result: completed ? (completed.payload as Record<string, unknown>) : null,
    errors: errors.map((e) => e.error).filter(Boolean),
  });
}
