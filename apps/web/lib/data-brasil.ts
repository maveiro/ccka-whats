import "server-only";

// O formulário de agenda usa <input type="datetime-local">, que produz uma
// string SEM fuso ("2026-10-23T21:00"). `new Date()` nesse formato usa o fuso
// do processo — e o servidor da Vercel roda em UTC, então 21:00 digitado
// virava 21:00Z e o fã via 18:00 (achado em produção em 09/09/2026, com os
// dois primeiros shows reais cadastrados).
//
// Shows são no Brasil e o país não tem mais horário de verão desde 2019, então
// o deslocamento é fixo em -03:00. Se um dia houver show fora do Brasil, isto
// precisa virar fuso por show (guardar hora local + timezone do local), não um
// offset global.
const OFFSET_BRASIL = "-03:00";

/** Interpreta a string do formulário como horário de Brasília. */
export function dataLocalParaIso(valor: string): Date {
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(valor.trim());
  return new Date(naive ? `${valor.trim()}${OFFSET_BRASIL}` : valor);
}
