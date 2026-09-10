import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Recebimento PÚBLICO de cadastro — a primeira rota do projeto sem usuário
// autenticado nem assinatura. Tudo mais é painel (autenticado), webhook da Meta
// (assinado) ou interno (service role).
//
// Não há segredo a proteger: qualquer chave estaria no HTML da página que
// embute o formulário. As defesas são outras, e todas estão aqui:
//   * o formulário precisa existir e estar ATIVO (desligar é a defesa final);
//   * lista de domínios, conferida por Origin/Referer — barra o uso casual em
//     outro site, não um script fora do navegador;
//   * honeypot (campo que humano não vê e bot preenche);
//   * limite por IP e por janela;
//   * resposta SEMPRE idêntica — sucesso e "já existe" são indistinguíveis,
//     senão a rota vira um oráculo de "esse telefone está na base?".
//
// A gravação em si é a porta única (registrar_cliente, migration 0033): a
// versão do consentimento vem do formulário, não de constante no código.

const JANELA_MINUTOS = 10;
const MAX_POR_IP_NA_JANELA = 5;

// Resposta única, seja qual for o desfecho não-erro.
const OK = { ok: true } as const;

interface Formulario {
  id: string;
  tenant_id: string;
  ativo: boolean;
  exige_nome: boolean;
  exige_email: boolean;
  versao_consentimento: string;
  dominios_permitidos: string[];
  mensagem_sucesso: string;
}

async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`cadastro:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function origemPermitida(req: NextRequest, dominios: string[]): boolean {
  if (dominios.length === 0) return true;

  const bruto = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  if (!bruto) return false;
  try {
    const host = new URL(bruto).hostname.toLowerCase();
    return dominios.some((d) => {
      const alvo = d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return host === alvo || host.endsWith(`.${alvo}`);
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const admin = createAdminClient();

  const { data: form } = await admin
    .from("formularios_cadastro")
    .select("id, tenant_id, ativo, exige_nome, exige_email, versao_consentimento, dominios_permitidos, mensagem_sucesso")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle<Formulario>();

  if (!form || !form.ativo) {
    return NextResponse.json({ error: "Formulário indisponível" }, { status: 404 });
  }

  if (!origemPermitida(req, form.dominios_permitidos)) {
    return NextResponse.json({ error: "Origem não autorizada" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  // Honeypot: campo escondido no HTML. Humano não vê, bot preenche. Responde
  // SUCESSO — dizer "recusado" ensinaria o bot a não preencher da próxima vez.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json(OK, { status: 200 });
  }

  const telefone = typeof body.telefone === "string" ? body.telefone.trim() : "";
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const consentiu = body.consentiu === true;

  if (!consentiu) {
    return NextResponse.json({ error: "É preciso aceitar os termos para continuar" }, { status: 400 });
  }
  if (telefone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Informe um telefone com DDD" }, { status: 400 });
  }
  if (form.exige_nome && !nome) {
    return NextResponse.json({ error: "Informe seu nome" }, { status: 400 });
  }
  if (form.exige_email && !email) {
    return NextResponse.json({ error: "Informe seu e-mail" }, { status: 400 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";
  const ipHash = await hashIp(ip);
  const desde = new Date(Date.now() - JANELA_MINUTOS * 60_000).toISOString();

  const { count } = await admin
    .from("formulario_envios")
    .select("id", { count: "exact", head: true })
    .eq("formulario_id", form.id)
    .eq("ip_hash", ipHash)
    .gte("created_at", desde);

  if ((count ?? 0) >= MAX_POR_IP_NA_JANELA) {
    // 429 é o único caso em que a resposta difere — e não revela nada sobre a
    // base, só sobre o próprio remetente.
    return NextResponse.json({ error: "Muitos envios. Tente novamente em alguns minutos." }, { status: 429 });
  }

  const { error } = await admin.rpc("registrar_cliente", {
    p_tenant_id: form.tenant_id,
    p_telefone: telefone,
    p_nome: nome || null,
    p_email: email || null,
    p_origem: "landing",
    p_consentimento_versao: form.versao_consentimento,
    p_consentimento_origem: `formulario:${slug}`,
  });

  if (error) {
    // Telefone que a normalização recusa é erro de quem preencheu; o resto é
    // nosso e não deve virar detalhe técnico na cara do visitante.
    const ehTelefone = error.message.includes("telefone inválido");
    if (!ehTelefone) console.error("[public/cadastro] falha ao registrar:", error.message);
    return NextResponse.json(
      { error: ehTelefone ? "Telefone inválido" : "Não foi possível concluir agora" },
      { status: ehTelefone ? 400 : 500 },
    );
  }

  await admin.from("formulario_envios").insert({ formulario_id: form.id, ip_hash: ipHash });

  return NextResponse.json({ ...OK, mensagem: form.mensagem_sucesso }, { status: 200 });
}
