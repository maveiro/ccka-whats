// A combinação "bolinha colorida + label" existe hoje em pelo menos 3 lugares
// (sidebar.tsx, session-card.tsx) com paletas ligeiramente diferentes. Não é
// dropdown nem precisa de estado — só nomeia o padrão visual.
const TONE_DOT: Record<string, string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400 animate-pulse",
  gray: "bg-gray-500",
};

// -400 fica claro demais em fundo branco (achado na auditoria de a11y de
// 22/09/2026 — mesma razão do rebaixamento de text-gray-500 no resto do app).
const TONE_TEXT: Record<string, string> = {
  green: "text-green-400 light:text-green-700",
  red: "text-red-400 light:text-red-700",
  yellow: "text-yellow-400 light:text-yellow-700",
  gray: "text-gray-400 light:text-gray-600",
};

type Tone = keyof typeof TONE_DOT;

export default function StatusDot({
  tone,
  label,
  showLabel = true,
}: {
  tone: Tone;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}`} aria-hidden={showLabel} aria-label={showLabel ? undefined : label} />
      {showLabel && <span className={`text-xs ${TONE_TEXT[tone]}`}>{label}</span>}
    </span>
  );
}
