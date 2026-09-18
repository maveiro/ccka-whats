<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Regras do frontend (apps/web)

O briefing do produto é o `CLAUDE.md` da **raiz** do monorepo — leia-o antes de
qualquer implementação. Este arquivo é só o que muda ao tocar no web app.

## Antes de considerar pronto

```bash
cd apps/web
npx tsc --noEmit -p tsconfig.json     # tipos
npx next build                        # build
cd ../.. && node scripts/lint-baseline.mjs   # lint, por linha de base
```

O mesmo roda no CI (`.github/workflows/ci.yml`) a cada PR, junto da suíte de
banco.

## Lint: linha de base, não "zero erros"

O repo carrega **8 erros herdados** (`.eslint-baseline.json`), seis do mesmo
`react-hooks/set-state-in-effect`, em componentes que estão em produção e
funcionando. O CI trava o **nono**.

Na prática: **não adicione erro novo**. Se você corrigir algum dos antigos,
rode `node scripts/lint-baseline.mjs --atualizar` e commite o número menor — a
base só desce.

## Buscar dados em componente de cliente

**Nunca `useEffect` + `setState`** — é exatamente o erro herdado acima, e somar
mais um torna o lint inútil como sinal. O padrão adotado é `use()` com promessa
memorizada e `Suspense`:

```tsx
const promessa = useMemo(() => buscar(id, periodo), [id, periodo]);
// ...
<Suspense fallback={...}><Conteudo promessa={promessa} /></Suspense>
```

O erro da requisição vira **valor** (`{ erro: string }`), não exceção, para não
precisar de error boundary. Exemplos prontos:
`app/dashboard/admin/paginas/metricas-pagina.tsx` e
`app/dashboard/admin/saude/saude-manager.tsx`.

Melhor ainda: buscar no Server Component e passar por prop. Só use o cliente
quando o dado muda por interação (troca de período, filtro).

## Resposta de rota pode não ser JSON

Rota que estoura o tempo limite da Vercel devolve **HTML**, e `res.json()`
quebra com `Unexpected token '<'` — erro que não diz nada a quem está na tela
(aconteceu em 17/09/2026). Em chamada que pode demorar, leia como texto e só
então tente `JSON.parse`, com mensagem acionável no `catch`. Exemplo:
`app/dashboard/admin/agenda/agenda-fontes.tsx`.

## Cliente do Supabase: autenticado por padrão

`createClient()` (autenticado) é o padrão — a RLS filtra por tenant, e
`.eq("tenant_id", ...)` redundante é erro (regra 15 do CLAUDE.md).

`createAdminClient()` (service role) **só** para tabela com RLS deny-all
(`integrations`, `whatsapp_cloud_credentials`, `agenda_conexoes`,
`internal_secrets`) ou para página pública sem sessão. Nesses casos o
`.eq("tenant_id", ...)` passa a ser **obrigatório**.

## Rotas públicas

`/f/` (formulário), `/c/` (redirect de campanha), `/a/` (página do artista) e
`/l/` (redirect da página) rodam **sem sessão** e estão em `publicPaths` do
`proxy.ts`. Rota nova pública entra lá **e** tem de se defender sozinha.

Duas regras que valem para todas: **nunca devolver erro** a quem está do outro
lado (redirect para a home é melhor que 500 na cara de um comprador) e
`export const dynamic = "force-dynamic"` em quem conta clique — servida do
cache, a rota pararia de contar sem dar erro nenhum.

## Next.js 16 — o que mais pega

- `proxy.ts` no lugar de `middleware.ts`, exportando `proxy()`
- `params` em Route Handler e página é **Promise**: `const { id } = await params`
- `searchParams` também é Promise em Server Component
