> **Retrato da Fase 1 (junho/2026) — não é o estado atual.**
>
> Este arquivo não é atualizado desde 24/06/2026 e descreve o produto quando
> ele era captura de mensagens e busca. Tudo que veio depois — campanhas pela
> Cloud API, automação por Flow e central de shows, ponte com o Monday via
> painel-shows, página pública do artista, ledger de custos, vigilância do
> events_log — **não está aqui**.
>
> O estado corrente, as regras inegociáveis e as armadilhas já pagas vivem no
> `CLAUDE.md` da raiz; o desenho de cada módulo, em `docs/prd/`. Mantido como
> registro histórico porque a Fase 1 ainda é a base do pipeline Evolution.

# Web App — Next.js 15 Dashboard

## Estrutura de rotas

```
/login                         → autenticação
/dashboard                     → mensagens do operador logado
/dashboard/admin               → gestão de sessões (role: admin)
/dashboard/admin/sessions      → conectar/desconectar números
/dashboard/analytics           → volume, tempo de resposta (fase 2)
/dashboard/search              → busca semântica (fase 2)
/dashboard/settings            → configurações do tenant
/dashboard/settings/integrations → Monday, CRM, webhooks (fase 2)
```

## Auth e roles

Roles definidos em `operators.role`:
- `admin` — acesso total ao tenant
- `operator` — acesso apenas ao próprio session_id
- `viewer` — acesso leitura apenas (fase 2)

O middleware Next.js valida role server-side antes de renderizar.
RLS no banco é a segunda linha de defesa.

## Componentes principais

### SessionCard (admin)
- Exibe status da sessão (connected/disconnected/connecting)
- QR code quando `status = 'connecting'`
- Atualiza em tempo real via Supabase Realtime
- Botões: Conectar, Desconectar

### MessageList (operador)
- Lista mensagens do número próprio
- Agrupadas por chat
- Filtros: tipo (texto/áudio/imagem), direção (enviado/recebido), período
- Paginação server-side (cursor-based)

### ChatView
- Mensagens de uma conversa específica
- Renderização por tipo: texto, áudio (player), imagem (thumbnail), documento

## Convenções Next.js

- Server Components por padrão — Client Components apenas quando necessário
  (interatividade, Realtime, formulários)
- `loading.tsx` em toda rota com fetch de dados
- `error.tsx` em toda rota crítica
- Route Handlers (`/api/...`) apenas para operações que precisam de
  `SUPABASE_SERVICE_ROLE_KEY` ou chamadas ao Evolution API
- Nunca fazer chamadas ao Evolution API diretamente do cliente

## Tipagem do banco

Os tipos TypeScript do schema ficam em `packages/database/types.ts`,
gerados via `supabase gen types typescript`.

Sempre importar de lá — nunca definir tipos de banco inline.
