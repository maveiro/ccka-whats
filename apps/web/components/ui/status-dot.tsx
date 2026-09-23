// A combinação "bolinha colorida + label" existe hoje em pelo menos 3 lugares
// (sidebar.tsx, session-card.tsx) com paletas ligeiramente diferentes. Não é
// dropdown nem precisa de estado — só nomeia o padrão visual.
const TONE_DOT: Record<string, string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400 animate-pulse",
  gray: "bg-gray-500",
};

const TONE_TEXT: Record<string, string> = {
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  gray: "text-gray-400",
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
