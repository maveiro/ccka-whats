// Domínios que autenticam só via Google (sem senha) — ver regra 19 do CLAUDE.md.
// Usado tanto em /auth/callback (barreira de login) quanto no convite de operadores
// (pra não mandar fluxo de "definir senha" pra quem nunca vai usar senha).
export const GOOGLE_ONLY_DOMAINS = ["plauz.com.br"];

export function isGoogleOnlyEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && GOOGLE_ONLY_DOMAINS.includes(domain);
}
