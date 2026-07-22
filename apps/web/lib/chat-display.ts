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
  return "Contato sem nome";
}
