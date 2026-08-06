import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, status, total_recipients, sent_count, delivered_count, read_count, failed_count, updated_at")
    .eq("id", id)
    .eq("tenant_id", operator.tenant_id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  return NextResponse.json(data);
}
