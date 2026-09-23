import { LucideIcon } from "lucide-react";

// 23 telas já tinham algum texto de "nenhum item", cada uma com seu próprio
// espaçamento/tom (achado na revisão de UX de 22/09/2026). Este componente
// não muda o texto de ninguém — só dá a elas um mesmo invólucro.
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-gray-400 light:bg-gray-100 light:text-gray-500">
          <Icon size={18} aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium text-gray-300 light:text-gray-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-gray-400 light:text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
