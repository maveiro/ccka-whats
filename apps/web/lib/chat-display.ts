export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
}

// `chats.name` é gravado como o próprio JID quando o nome ainda não foi resolvido
// (ver whatsapp-webhook) — nunca fica null. `name === jid` é o sinal de "não resolvido".
export function displayChatName(name: string | null, jid: string): string {
  if (name && name !== jid) return name;
  if (jid.endsWith("@g.us")) return "Grupo sem nome";
  if (jid.endsWith("@s.whatsapp.net")) {
    const digits = jid.split("@")[0];
    if (/^\d+$/.test(digits)) return formatPhone(digits);
  }
  // jid do WhatsApp Cloud API (módulo de campanhas): número E.164 puro,
  // sem sufixo de domínio — ex: "5541999999999".
  if (/^\d+$/.test(jid)) return formatPhone(jid);
  return "Contato sem nome";
}

// --- Data/hora das mensagens -------------------------------------------------
// A bolha mostra só a hora (como no WhatsApp); quem dá a data é o separador de
// dia inserido entre mensagens de dias diferentes, mais o title com a data
// completa em qualquer hora exibida.

/** Chave local do dia (YYYY-MM-DD) — compara dias no fuso do navegador. */
export function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Rótulo do separador de dia: "hoje", "ontem", dia da semana (até 7d) ou data. */
export function formatDateSeparator(dateStr: string): string {
  const alvo = dayKey(dateStr);
  const hoje = new Date();
  if (alvo === dayKey(hoje.toISOString())) return "hoje";

  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  if (alvo === dayKey(ontem.toISOString())) return "ontem";

  const d = new Date(dateStr);
  const diasAtras = (hoje.getTime() - d.getTime()) / 86_400_000;
  if (diasAtras < 7) {
    return d.toLocaleDateString("pt-BR", { weekday: "long" });
  }
  // Ano só aparece quando não é o ano corrente — ruído a menos no caso comum.
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(d.getFullYear() === hoje.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Data + hora por extenso, para o `title` da hora na bolha. */
export function formatFullDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
