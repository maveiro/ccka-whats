import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("alerts")
    .select("id, name, keywords, active, session_id, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as { name?: unknown; keywords?: unknown; sessionId?: unknown };
  const { name, keywords, sessionId } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: "keywords must be a non-empty array" }, { status: 400 });
  }
  const keywordsStr = keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  if (keywordsStr.length === 0) {
    return NextResponse.json({ error: "keywords must contain at least one non-empty string" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("alerts")
    .insert({
      tenant_id: operator.tenant_id,
      name: name.trim(),
      keywords: keywordsStr,
      session_id: typeof sessionId === "string" && sessionId ? sessionId : null,
      active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
