// Base para telas que buscam dado no cliente (padrão `use()`+Suspense do
// AGENTS.md) — hoje só 2 das ~17 seções admin seguem esse padrão com um
// fallback visual; as demais ou não têm skeleton, ou reimplementam o próprio
// `animate-pulse` na hora. Uso: <Suspense fallback={<Skeleton className="h-24" />}>.
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-800 light:bg-gray-200 ${className}`} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
