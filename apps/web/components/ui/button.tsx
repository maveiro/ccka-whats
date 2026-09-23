import { ButtonHTMLAttributes, forwardRef } from "react";

// Piloto do design system: hoje cada tela reimplementa suas próprias classes
// de botão (achado na revisão de UX de 22/09/2026 — 122 combinações distintas
// em 74 arquivos). Este componente não inventa cores novas: só nomeia os
// padrões que já existiam espalhados (verde = conectar/confirmar, cinza =
// ação neutra, vermelho = destrutivo, ghost = ação secundária discreta) para
// que parem de divergir sozinhos tela a tela.

type Variant = "primary" | "secondary" | "danger" | "dangerOutline" | "ghost" | "warning";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-green-700 hover:bg-green-600 text-white",
  secondary: "bg-gray-700 hover:bg-gray-600 text-gray-100",
  danger: "bg-red-700 hover:bg-red-600 text-white",
  dangerOutline: "bg-transparent border border-red-800 text-red-500 hover:bg-red-900/30",
  ghost: "bg-transparent border border-gray-700 text-gray-300 hover:bg-gray-800",
  warning: "bg-yellow-800 hover:bg-yellow-700 text-yellow-200",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1",
  md: "text-sm px-3 py-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "secondary", size = "sm", loading = false, loadingText, disabled, className = "", children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 focus-visible:ring-gray-400 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...props}
      >
        {loading ? (loadingText ?? "...") : children}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
