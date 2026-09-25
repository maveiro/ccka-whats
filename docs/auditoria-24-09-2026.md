# Auditoria multiperspectiva — 24/09/2026

Quatro leituras independentes do repositório, cada uma com um mandato fechado:
**segurança**, **aderência arquitetural ao CLAUDE.md**, **banco de dados** e
**UX/UI**. Leitura estática do código, sem acesso a produção — onde um achado
depende de estado de produção, isso está dito. Ordenado por risco, não por
esforço. Os agentes não se comunicaram entre si; onde dois chegaram ao mesmo
ponto por caminhos diferentes, isso está marcado.

Versão navegável (artifacts privados, fora do repo): *Auditoria WA
Intelligence* e *Sprints WA Intelligence*. **Este arquivo é a fonte que
sobrevive** — os artifacts não são versionados.

---

## Achado cruzado — confirmado por dois agentes, em duas camadas

**Funções internas confiam no gate errado: qualquer chamador autenticado (às
vezes anônimo) contorna a autorização.**

**Camada HTTP (segurança).** `verify_jwt = true` só valida que o token está
**assinado** com o segredo do projeto — não confere a claim `role`. A **anon
key pública** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, embutida em qualquer bundle do
frontend) é ela mesma um JWT válido e passa nesse gate. Nenhuma das funções
abaixo confere identidade por dentro; os comentários no código afirmam o
oposto ("só chamada internamente com service role" —
`campaign-sender/index.ts:7`, `flow-engine/index.ts:9`).

Funções afetadas (`supabase/config.toml:270-307`): `delete-session`,
`flow-engine`, `campaign-sender`, `generate-embeddings`, `webhook-delivery`,
`history-sync`, `agenda-sync`.

Cenários reais, por função:

- **`delete-session`** — recebe só `{ sessionId }`, sem checar tenant. Um POST
  direto com a anon key apaga mensagens, chats, mídia no Storage e a sessão de
  **qualquer tenant**, contornando a checagem `role='admin'` que existe em
  `DELETE /api/sessions/[id]` (`apps/web/app/api/sessions/[id]/route.ts:24-26`).
- **`flow-engine`** — aceita `{ messageId, phoneNumberId, from, text, ... }`
  livres: dá para impersonar mensagem inbound de qualquer número e fazer o
  motor **enviar WhatsApp real** às custas do tenant vítima, forçar
  `registrar_cliente`, tentar `/reset` contra números de teste de outro
  tenant, e esgotar a nota de qualidade do número (regra 62).
- **`campaign-sender`** — chamar em paralelo, direto, **contorna o throttle**
  desenhado depois do incidente de 07/08/2026 e reproduz a mesma rajada.
- **`generate-embeddings`** — chamadas pagas à OpenAI com a chave da
  **plataforma** (abuso de custo).
- **`webhook-delivery`** — forjar evento arbitrário para o webhook de
  qualquer tenant cujo UUID o atacante descubra.
- **`history-sync` / `agenda-sync`** — disparar trabalho custoso para
  sessões/tenants arbitrários.

**Camada Postgres (banco).** Funções `security definer` que recebem
`p_tenant_id` / `p_campaign_id` / `p_filtro_id` **como parâmetro e confiam
nele**, sem `and tenant_id = my_tenant_id()`, e **sem `REVOKE EXECUTE ... FROM
PUBLIC`** em nenhuma migration (só há um `GRANT EXECUTE` explícito no repo
inteiro: `search_messages_semantic`, 0006). Em Postgres/PostgREST, `EXECUTE`
em função nova é concedido a `PUBLIC` por padrão — logo, **se o grant padrão
não foi revogado em produção**, qualquer `authenticated` chama
`POST /rest/v1/rpc/<função>` e contorna a RLS inteira:

- `registrar_cliente()` / `buscar_cliente()` (0033/0037/0039) — grava/lê PII
  de qualquer `tenant_id` passado.
- `resetar_cadastro_teste()` (0038) — apaga cadastro de outro tenant
  (mitigado em parte pela lista `numeros_de_teste`, mas `p_tenant_id` não é
  validado contra o chamador).
- `try_lock_gate()` / `unlock_gate()` (0026).
- `claim_campaign_recipients()` / `reclaim_stuck_campaign_recipients()` (0019)
  — **devolve `phone_e164`/`variables`/`wamid` de destinatários de outro
  tenant** (`returns setof campaign_recipients`) e os marca `sending`/`failed`:
  vazamento de PII cross-tenant.
- `taxa_de_falha_recente()` — métricas de campanha de outro tenant por
  `campaign_id`.
- `sincronizar_agenda_shows()` — grava `link_compra` (link mostrado a fãs numa
  página pública) em qualquer `agenda_filtros.id`: risco de phishing.
- `invoke_campaign_sender_for_active()` / `avisar_erros_do_events_log()` — sem
  parâmetro, mas disparam HTTP sobre **todos os tenants**; chamada externa
  pode suprimir o alerta real do dia (grava em `erros_avisados` antes de
  enviar).
- `erros_para_avisar()` — devolve amostras de erro de **todos** os tenants.

**Por que é a mesma falha:** a Edge Function assume que o Postgres protege, o
Postgres assume que a Edge Function protege. Nenhum dos dois protege. O padrão
correto já existe no repo — `costs_summary`, `campaign_cost`,
`cancelar_campanha`, `resumo_de_erros`, `metricas_pagina` derivam o tenant de
`my_tenant_id()` internamente.

**Antes de tratar como incidente, confirmar em produção** (uma query):

```sql
select routine_name
from information_schema.routine_privileges
where grantee = 'PUBLIC' and routine_schema = 'public';
```

---

## Segurança

Único achado crítico da leitura de segurança é o cruzado acima. Revisado e
considerado **correto**:

- `whatsapp-cloud-webhook` — HMAC SHA-256 em tempo constante
  (`index.ts:190-210`).
- `flow-endpoint` — nunca recebe telefone da Meta (regra 28), sessão só por
  `flow_token` opaco, chave privada em `internal_secrets`, cadastro grava só o
  telefone vindo da sessão (`index.ts:428-431`).
- `/c/[token]` e `/l/[bloco]` — nunca vazam erro, validam esquema da URL
  antes de redirecionar (bloqueiam `javascript:`), `Cache-Control: no-store`.
- Módulo de templates — toda rota nova checa `role==='admin'` e confirma o
  `tenant_id` da credencial antes de usar (IDOR-safe).
- `paginas_publicas`/`pagina_blocos` — RLS `tenant_id = my_tenant_id()` cobre
  PATCH/DELETE por `id` sem filtro redundante (regra 15).
- `proxy.ts` exclui `/api/*` por design (cada handler se autoprotege) — nenhuma
  rota administrativa revisada ficou sem o check. **Padrão frágil por
  natureza:** uma rota nova que esqueça o check fica exposta.
- Nenhuma exposição de `SUPABASE_SERVICE_ROLE_KEY` no client.

---

## Arquitetura (aderência ao CLAUDE.md)

### A1. Regra 15 violada de forma literal — e a documentação que levou ao erro está errada  · médio

`app/dashboard/admin/aprendizados/page.tsx:20`,
`app/api/learnings/[id]/route.ts:13` e
`app/dashboard/admin/integrations/page.tsx:20` usam `createClient()`
autenticado e ainda fazem `.eq("tenant_id", ...)`. A RLS de `learnings`
(`0024_learnings.sql:19`) é `tenant_isolation` padrão — o filtro é
redundância pura. Para `integrations`, o `apps/web/AGENTS.md` lista a tabela
como "RLS deny-all", mas a policy real (`0001_initial.sql:254`) é `admin_only`
comum (`tenant_id = my_tenant_id() and my_role() = 'admin'`), **não**
`using (false)`. A documentação está desatualizada e o código herdou o erro.

### A2. Duas tabelas sem `tenant_id` fora da lista de exceções da regra 1  · baixo

`internal_secrets` (0023) e `formulario_envios` (0035). Ambas com RLS
deny-all — sem vazamento —, mas a regra 1 exige que toda exceção se justifique
**na própria regra**, que hoje cita só `whatsapp_rates`.

### A3. `OperatorRole` promete um terceiro papel que não existe  · baixo

`packages/types/index.ts:4` declara `"admin" | "operator" | "viewer"`. Zero
ocorrências de `"viewer"` fora dessa declaração e do comentário em
`0001_initial.sql:34`; sem `check` constraint, sem policy, sem tela.

Revisado e **aderente**: upserts do pipeline principal com `onConflict`
correto (regra 4); `events_log` sempre com `event_type`/`payload`/`error`
(regra 12); `MessageType` completo (regra 14); migrations novas em timestamp;
módulo de templates dentro dos limites das notas de reabertura (sem IA
gerando texto livre, sem inbox).

---

## Banco de dados

**Ressalva de método:** `npm run test:db` **não rodou** (CLI do Supabase
ausente no ambiente do agente, Docker sem stack). 60 migrations lidas
estaticamente. Rodar a suíte antes de mesclar qualquer fix.

### B1. Funções `security definer` sem REVOKE — crítico

É o achado cruzado acima, camada Postgres.

### B2. `alert_events.message_id` sem índice — crítico

`0007_alerts.sql`: FK `on delete cascade` para `messages(id)` **sem índice**.
A regra 18 já documenta que apagar sessão com histórico grande é feito em
lotes de 500 por causa de cascades caros — e resolveu o índice para
`media_files`/`chats`, mas `alert_events` ficou de fora. Cada lote faz seq scan
da tabela inteira (todos os tenants). Mesma família de bug que as regras
17/18 já pagaram.

### B3. Índices de apoio à RLS por tenant faltando  · alto

- `campaign_recipients.tenant_id` — só existe `(campaign_id, status)`.
- `campaigns.credential_id` — sem índice **e** sem `ON DELETE` explícito
  (`NO ACTION` implícito; deveria ser `restrict` explícito, como
  `campaigns.flow_id`).
- `pagina_cliques.tenant_id` — só `bloco_id`/`show_id`. Vai doer quando a
  replicação para outros artistas multiplicar o tráfego de páginas públicas.

### B4. Mais FKs sem índice, e cobertura de teste desigual  · médio

Sem índice: `flow_mensagens_processadas.flow_id`,
`clientes.gate_iniciado_por_flow_id`, `whatsapp_message_costs.session_id`,
`messages.contact_id`.

Sem teste dedicado (por leitura de `supabase/tests/`):
`resetar_cadastro_teste()` (apaga dado real de cliente, autorização só no
banco — regra 29); RLS deny-all de `internal_secrets` e
`whatsapp_cloud_credentials`; corrida de `try_lock_gate`/`unlock_gate`.

### B5. Nits  · baixo

- `alerts`/`alert_events` (0007) usam `(select tenant_id from operators where
  id = auth.uid())` inline em vez de `my_tenant_id()`.
- Policy de `formulario_envios` chama-se `admin_only` mas é `using (false)`
  (deny-all de verdade) — nome sugere que admin teria acesso.
- `ADD COLUMN` sem `IF NOT EXISTS` na quase totalidade (só
  `pausa_por_taxa.sql` usa) — convenção, não bug.

Revisado e **correto**: `0025_flows_automacao.sql` (melhor exemplo do repo);
funções que derivam tenant de `my_tenant_id()`; `publicado` fora do
`ON CONFLICT DO UPDATE` de `sincronizar_agenda_shows()` (regra 38); distinção
`set null`/`restrict` entre `flow_palavras_chave` e `campaigns.flow_id`.

---

## UX/UI

Contraste, tema claro, responsividade e o design system base já estavam
fechados (axe-core: 0 violações em 20 telas, nos dois temas). O que sobrou:

### U1. Zero `loading.tsx` no app inteiro  · alto

Toda rota de `/dashboard/admin/*` é Server Component com `await` no render
(ex.: `campaigns/page.tsx` faz duas queries em sequência). Sem `loading.tsx`, a
navegação congela até a página inteira estar pronta. `components/ui/skeleton.tsx`
existe, com **rollout zero** fora do próprio arquivo.

### U2. Campo obrigatório desabilita o botão sem dizer por quê  · alto

`campaign-wizard.tsx:305,321,548` — `missingTargetUrl` e `missingFlow`
desabilitam "Criar campanha" sem mensagem. O único erro visível é um banner
genérico no topo. É o fluxo de maior risco financeiro do produto.

### U3. Rollout do `Button` parou na metade  · médio

110 ocorrências de `<button>` cru em 37 arquivos contra 22 que importam
`Button`. Maiores concentradores: `paginas-manager.tsx` (10),
`flows-manager.tsx` (9), `agenda-fontes.tsx` (7).

### U4. Duas telas centrais sem `EmptyState`  · médio

`agenda-manager.tsx:170-174` e `paginas-manager.tsx:424-428` — `<p>` solto.

### U5. Gráfico "Custo por dia" sem tratamento de tela estreita  · baixo

`costs-dashboard.tsx:253-264` — até 30 colunas em `flex` sem `overflow-x-auto`.

### U6. Confirmação de exclusão não uniforme  · baixo

A maioria usa "dois toques"; `clientes-busca.tsx` exige digitar "APAGAR" (dado
LGPD). Conferir `session-card.tsx` e `alerts-manager.tsx`.

---

## Plano de execução — 4 sprints, 18 itens

### O que "teste sólido" significa neste repo

Existem **dois tipos** de teste automatizado, e é neles que todo fix de banco e
de Edge Function se apoia (`npm run test:db`, ~320 asserções, roda no CI):

| Tipo | Onde | Roda no CI |
|---|---|---|
| SQL / RLS | `supabase/tests/*.sql`, dentro de `begin/rollback` | sim |
| Edge Function | `supabase/tests/*.e2e.ts` (Deno, API externa stubada) | sim |

**O frontend não tem suíte automatizada nenhuma.** Para os itens de UI o rigor
disponível é: `tsc` + `lint-baseline` + `next build` limpos (roda no CI) e
verificação visual via Puppeteer contra dado real (**não** persiste no CI —
confirma comportamento antes de fechar o item, não protege contra regressão).
Isso está marcado em cada item; não é para ser lido como equivalente a teste
automatizado.

Direção registrada para fechar essa lacuna (ainda **não** decidida/feita):
**Vitest** para lógica pura (`lib/chat-display.ts`, `lib/pagina-tema.ts`,
`templateComponents.ts`) + **Playwright** para 4-5 fluxos críticos (login →
enviar mensagem, criar campanha, trocar tema) contra o mesmo Supabase local que
o job `banco` já sobe. Trade-off: e2e de browser é o teste mais caro de manter
(flaky, engorda o CI) — por isso só os fluxos que mais doeriam.

### Sprint 1 — Fechar a porta · bloqueante

Nada novo é construído sobre este código até esses quatro itens fecharem.

**1.1 Confirmar o alcance real em produção** (não é código). Rodar a query de
`information_schema.routine_privileges` acima; colar o resultado no commit do
1.2. *Aceite:* evidência do estado real registrada antes do fix.

**1.2 `REVOKE EXECUTE ... FROM PUBLIC` nas funções sensíveis a tenant.**
Migration nova (timestamp) em `registrar_cliente`, `buscar_cliente`,
`resetar_cadastro_teste`, `try_lock_gate`, `unlock_gate`,
`claim_campaign_recipients`, `reclaim_stuck_campaign_recipients`,
`taxa_de_falha_recente`, `sincronizar_agenda_shows`,
`invoke_campaign_sender_for_active`, `avisar_erros_do_events_log`,
`erros_para_avisar` → `GRANT ... TO service_role`. Onde o client autenticado
também chama, trocar por checagem interna `tenant_id = my_tenant_id()`
(padrão de `costs_summary`).
*Teste:* `supabase/tests/seguranca_rpc_revogado.sql` — em `begin/rollback`,
`set role authenticated;` e chamar cada função esperando permissão negada
(falha se alguém reintroduzir o grant amplo); par positivo com
`set role service_role;` mostrando que o caminho legítimo segue funcionando.

**1.3 Segredo compartilhado nas Edge Functions internas.** Header
`X-Internal-Secret` conferido, em tempo constante, contra `internal_secrets`
(mesmo padrão do cron → `campaign-sender-tick`) nas sete funções. Sem o header
certo: `401` antes de tocar em dado.
*Teste:* um caso novo por função no `*.e2e.ts` que já existe para ela — sem
header → `401`; header errado → `401`; header certo → segue o fluxo já coberto
(reaproveitar os stubs de `flow_engine.e2e.ts`/`cloud_webhook.e2e.ts`).

**1.4 Índice em `alert_events.message_id`.** Migration de uma linha.
*Teste:* regressão, não performance — a suíte de RLS de `alert_events` (0007)
continua verde. **Marcado deliberadamente como não coberto por teste de
performance**; não há teste de plano de execução na suíte e criar um seria
desproporcional ao fix.

### Sprint 2 — Antes que doa · alto impacto

**2.1 Índices de RLS + `ON DELETE` explícito** (B3). Migration com os três
índices e `campaigns.credential_id ... on delete restrict`.
*Teste:* `supabase/tests/campanhas_credencial_restrict.sql` — apagar uma
`whatsapp_cloud_credentials` referenciada por `campaigns` → erro de FK
(replica o teste que já existe para `flow_id`).

**2.2 `loading.tsx` nas 5 rotas mais visitadas** (`campaigns`, `templates`,
`costs`, `analytics`, `admin/agenda`) usando `<SkeletonRows/>`.
*Teste:* build limpo + Puppeteer com throttling de rede
(`page.emulateNetworkConditions`) confirmando skeleton antes do conteúdo.
*Frontend — sem suíte automatizada.*

**2.3 Validação inline no `campaign-wizard`.** Texto abaixo do campo quando
`missingTargetUrl`/`missingFlow` for o motivo do botão desabilitado (padrão
`text-amber-400` que o arquivo já usa).
*Teste:* build limpo + Puppeteer preenchendo o wizard até cada condição.
*Frontend — sem suíte automatizada.*

### Sprint 3 — Consistência · dívida documentada

**3.1 Remover `.eq("tenant_id")` redundante e corrigir o `AGENTS.md`** (A1).
*Teste:* suíte de RLS existente de `learnings`/`integrations` continua verde —
o contrato de dados não muda.

**3.2 Documentar as exceções de `tenant_id`** na regra 1 (A2). *Teste:* n/a
(documentação).

**3.3 Rollout do `Button`** em `paginas-manager.tsx` e `flows-manager.tsx`
(U3). Mesmo critério de antes: só CTA sólido, não texto-link nem seletor.
*Teste:* build limpo + checagem de contagem `<Button>`/`</Button>` por arquivo
(pegou uma tag órfã real na rodada anterior). *Frontend.*

**3.4 `EmptyState`** em `agenda-manager.tsx` e `paginas-manager.tsx` (U4).
*Teste:* build limpo. *Frontend.*

**3.5 Escrever os três testes de banco que faltam** (B4):
`reset_de_teste_autorizacao.sql` (número fora da lista intacto; na lista,
apagado por completo), `internal_secrets_deny_all.sql` +
`whatsapp_cloud_credentials_deny_all.sql`, `gate_lock_corrida.sql` (só um de
dois updates concorrentes pega o lock).

### Sprint 4 — Polimento · baixo risco

Sem dependência entre si nem com os sprints anteriores.

- **4.1** Remover `"viewer"` de `OperatorRole` (A3) — `tsc` confirma.
- **4.2** Renomear a policy de `formulario_envios` para `deny_all` (B5) —
  suíte de RLS existente.
- **4.3** `my_tenant_id()` no lugar da subquery inline em `alerts` (B5) —
  suíte de RLS existente.
- **4.4** Os quatro índices de FK restantes (B4) — regressão, como o 1.4.
- **4.5** `overflow-x-auto` + `min-w-max` no gráfico de custo (U5) — build +
  Puppeteer em 375px. *Frontend.*
- **4.6** Padronizar confirmação de exclusão (U6) — build + Puppeteer clicando
  duas vezes. *Frontend.*

Dependências: só **internas a cada sprint** (ex.: 1.1 antes de 1.2), nunca
entre sprints. Sprints 2-4 podem ser reordenados ou intercalados com outro
trabalho.

---

## Status

Nenhum dos 18 itens foi executado na data desta auditoria. **Sprint 1 é
correção de vulnerabilidade confirmada por dois agentes independentes** — não
espera decisão de escopo maior; entra assim que os testes 1.2/1.3 passarem.
