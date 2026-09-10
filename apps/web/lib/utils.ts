export function formatDistanceToNow(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;

  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Custo em BRL. Tarifa de mensagem tem 4 casas relevantes (utilidade =
 * R$ 0,0350), então valor abaixo de R$ 1 mostra 4 casas em vez de 2 —
 * arredondar para centavos aqui esconderia justamente a ordem de grandeza
 * que o usuário está tentando enxergar.
 */
export function formatCurrency(value: number): string {
  const casas = Math.abs(value) > 0 && Math.abs(value) < 1 ? 4 : 2;
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
