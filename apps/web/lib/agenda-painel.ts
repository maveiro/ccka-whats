import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

// Acesso à API interna do painel-shows (ponte da ADR 0006 do plauz-core).
//
// A conexão vive em `agenda_conexoes`, RLS deny-all — é token de API com
// poder de leitura sobre a operação de shows inteira. Só este módulo
// server-only a lê, com admin client, e o token NUNCA volta para o browser
// (nem mascarado: a tela só mostra se está configurada ou não).

const TIMEOUT_MS = 15_000;

export interface Conexao {
  base_url: string;
  token: string;
  ativo: boolean;
}

export async function getConexao(tenantId: string): Promise<Conexao | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agenda_conexoes")
    .select("base_url, token, ativo")
    .eq("tenant_id", tenantId)
    .maybeSingle<Conexao>();
  return data ?? null;
}

export interface OpcoesDoBoard {
  artistas: string[];
  status: string[];
  espetaculos: string[];
}

/**
 * Valores que existem hoje na cópia do board que o painel-shows mantém.
 *
 * É o que faz a tela oferecer dropdown em vez de campo livre: `Vendendo`
 * digitado com erro produz agenda vazia sem erro nenhum (PRD, armadilha 4). E
 * é por isso que as opções vêm do painel, não de uma lista fixa no nosso
 * código — rótulo novo no board aparece aqui sem deploy.
 */
export async function buscarOpcoes(conexao: Conexao): Promise<OpcoesDoBoard> {
  const url = `${conexao.base_url.replace(/\/+$/, "")}/api/interno/agenda/filtros`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${conexao.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`painel-shows respondeu ${res.status}`);
  const json = await res.json() as Partial<OpcoesDoBoard>;
  return {
    artistas: json.artistas ?? [],
    status: json.status ?? [],
    espetaculos: json.espetaculos ?? [],
  };
}
