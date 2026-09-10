import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cadastro manual pelo painel — a menor das portas de entrada, e a primeira a
// usar `registrar_cliente` (migration 0033) fora do motor.
//
// Toda a regra (normalização de telefone, dedupe, não sobrescrever dado bom,
// consentimento versionado, respeito ao pii_apagada_em) vive na RPC. Aqui só
// há autorização e validação de forma — se esta rota reimplementasse qualquer
// dessas regras, estaríamos recriando o problema que a porta única resolveu.

// Versão do texto que o operador confirma ter coletado. Muda quando o texto
// que a Plauz usa para pedir consentimento mudar.
const VERSAO_CONSENTIMENTO_PAINEL = "painel-v1-2026-09";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode cadastrar cliente" }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const telefone = typeof body.telefone === "string" ? body.telefone.trim() : "";
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const consentiu = body.consentiu === true;

  if (!telefone) return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 });
  if (telefone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Telefone incompleto — informe DDD e número" }, { status: 400 });
  }

  // Sem consentimento marcado, o cadastro entra SEM carimbo em vez de fingir um
  // aceite que ninguém deu.
  const { data, error } = await supabase.rpc("registrar_cliente", {
    p_tenant_id: operator.tenant_id,
    p_telefone: telefone,
    p_nome: nome || null,
    p_email: email || null,
    p_origem: "painel",
    p_consentimento_versao: consentiu ? VERSAO_CONSENTIMENTO_PAINEL : null,
    p_consentimento_origem: consentiu ? "painel" : null,
  });

  if (error) {
    const ehValidacao = error.message.includes("telefone inválido");
    return NextResponse.json({ error: error.message }, { status: ehValidacao ? 400 : 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
