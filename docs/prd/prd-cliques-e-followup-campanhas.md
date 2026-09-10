# PRD: Cliques rastreáveis e follow-up segmentado de campanha — wa-intelligence

**Data:** 10/09/2026
**Status:** proposto, não implementado

## Contexto

O módulo de campanhas está em produção desde 06/08/2026 e já foi validado com
base real (1.889 destinatários). Os templates usados hoje têm dois tipos de
botão, e o produto enxerga só um deles:

| Botão | Exemplo real | Rastreado hoje? |
|-------|--------------|-----------------|
| Quick-reply | "Já Comprei!", "Não Vou Poder Ir! :(" | **Sim** — `campaign_recipients.button_reply` (migration 0022) |
| URL / call-to-action | "Comprar Meu Ingresso" | **Não** |

O botão de URL não é rastreável por limitação da Meta, não do nosso código:
clique em botão de link **não gera webhook nenhum**. O WhatsApp abre o navegador
e o Cloud API não expõe qualquer endpoint de "quem clicou".

Isso deixa o produto cego exatamente no botão que mais importa comercialmente —
o de compra. E, como consequência, não há como fazer a pergunta seguinte:
*"quem clicou em comprar e não comprou, me manda um lembrete daqui a 2h"*.

## Objetivo

Duas capacidades, independentes entre si mas que só entregam o caso de uso
completo juntas:

1. **Rastrear o clique no botão de URL** — trocando o link do template por um
   redirect nosso com token por destinatário.
2. **Disparar uma campanha de follow-up agendada para um público derivado de
   outra campanha** — "quem clicou no link", "quem respondeu 'Já Comprei!'",
   "quem recebeu e não interagiu".

## Fora de escopo

- **Atribuição de venda** (clicou → comprou). Exige integração com o checkout
  (Sympla/etc.), que é outro projeto. O redirect da Frente 1 deixa o caminho
  pronto — carrega UTM — mas fechar o laço não entra aqui.
- **Agendamento relativo por destinatário** ("2h após *esta pessoa* receber").
  Ver "Decisão: agendamento absoluto" abaixo.
- **Régua de automação multi-etapa** (fluxo com N passos condicionais). Isso é
  ferramenta de marketing automation e recairia no rumo que o CLAUDE.md fechou.
  Aqui é: uma campanha manual gera uma segunda campanha manual, com público
  pré-filtrado e horário marcado. O admin continua no controle de cada disparo.
- **Envio em texto livre dentro da janela de 24h.** Ver Sprint 3 (opcional).

## Posicionamento: precisa de nota nova no CLAUDE.md?

**Não.** Ambas as frentes ficam dentro da nota de reabertura consciente de
06/08/2026 (módulo de campanhas): continua sendo broadcast admin-only de
template pré-aprovado via Cloud API oficial, sem inbox de atendimento, sem
status/atribuição de conversa, sem IA gerando texto.

O que **exigiria** nota nova seria a régua de automação multi-etapa disparando
sozinha — e ela está explicitamente fora de escopo. Se voltar, a nota volta com
ela, **antes** do PR.

---

# Frente 1 — Link rastreável

## Como funciona

O template deixa de apontar direto para o destino e passa a apontar para um
redirect nosso com sufixo variável:

```
Template (aprovado na Meta):  https://<nosso-domínio>/c/{{1}}
Enviado para o destinatário:  https://<nosso-domínio>/c/k7Qm2xR9tA
Redirect 302 para:            https://sympla.com.br/evento/...?utm_campaign=...
```

A Meta só aceita variável no **final** da URL do botão (sufixo), o que casa
exatamente com esse desenho: base fixa + token.

## Modelo de dados

Migration `0040_campanhas_clique_rastreado.sql`:

```
campaigns
+ click_target_url  text          -- destino real do redirect
+ clicked_count     int default 0

campaign_recipients
+ click_token       text          -- unique, gerado no cadastro do destinatário
+ clicked_at        timestamptz   -- primeiro clique
+ click_count       int default 0 -- cliques totais (a pessoa pode voltar)
```

`click_token`: 10 chars base62 gerados na aplicação (não sequencial, não
derivado do telefone), `unique` no banco. Não precisa ser segredo
criptográfico — não dá acesso a nada, só identifica uma linha — mas precisa ser
não-enumerável para que ninguém varra tokens e infle contadores alheios.

Índice: `create unique index on campaign_recipients(click_token) where click_token is not null`.

`recompute_campaign_counters()` (0019) ganha `clicked_count` — mantendo a regra
já fixada de **recalcular, nunca incrementar por evento**.

## O endpoint de redirect

`apps/web/app/c/[token]/route.ts` — `GET`, público.

```
1. await params (Next.js 16 — params é Promise)
2. filtrar user-agent de crawler (ver armadilha abaixo) → 302 sem registrar
3. createAdminClient() → busca recipient por click_token (join campaigns)
4. update: clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1
5. recompute_campaign_counters(campaign_id)
6. 302 para campaigns.click_target_url
7. token inválido → 302 para a home (nunca 404: quem clicou é um cliente real,
   não pode ver tela de erro por bug nosso)
```

**Ponto crítico de UX: o redirect nunca pode falhar.** Se o passo 3–5 der erro,
o redirect acontece do mesmo jeito e o erro vai para `events_log`. Perder um
registro de clique é aceitável; deixar um comprador na tela de erro, não.

## Armadilhas conhecidas (a implementação precisa cobrir)

1. **Prefetch de crawler infla o contador.** `facebookexternalhit`, `WhatsApp/`
   e afins buscam a URL para gerar preview. Filtrar por user-agent **antes** de
   registrar. Sem isso, todo destinatário vira "clicou".
2. **Cache do Vercel serve o 302 sem executar o handler.** Precisa de
   `export const dynamic = "force-dynamic"` e `Cache-Control: no-store`. Sem
   isso, o segundo clique de qualquer pessoa não é contado.
3. **`/c/` precisa entrar em `publicPaths` no [proxy.ts](apps/web/proxy.ts#L38)** —
   mesmo tratamento que `/f/` (formulários públicos) já tem.
4. **`buildComponents()` no [campaign-sender](supabase/functions/campaign-sender/index.ts#L315)
   só monta o componente BODY.** Botão de URL dinâmico exige um componente
   adicional que hoje não existe:
   ```json
   {"type":"button","sub_type":"url","index":"0",
    "parameters":[{"type":"text","text":"<click_token>"}]}
   ```
   Sem isso o envio é rejeitado pela Graph API com erro de parâmetro faltando.
5. **`countPlaceholders()` no [campaign-wizard](apps/web/app/dashboard/admin/campaigns/campaign-wizard.tsx#L30)
   só conta placeholders do BODY.** A variável do botão **não** vem do CSV (é
   gerada por nós) — a UI precisa deixar isso explícito, senão o admin cria uma
   coluna a mais no CSV e desalinha todas as variáveis do corpo.
6. **Custo operacional real: o template precisa ser reaprovado pela Meta.**
   Mudar a URL do botão é uma nova versão do template, com o ciclo de aprovação
   junto. Isso não é código — é planejamento de calendário de campanha. Vale
   fazer a troca **fora** da semana de um lançamento.
7. **LGPD.** O log de clique é dado pessoal ligado a telefone. Como
   `campaign_recipients` já cascateia de `campaigns`, e a exclusão de PII
   (migration 0029) já existe para `clientes`, verificar se o fluxo de exclusão
   precisa alcançar `campaign_recipients` também.

---

# Frente 2 — Follow-up agendado e segmentado

## Decisão: agendamento absoluto, não relativo

"2h depois" é ambíguo quando o disparo original leva ~38 min (1.889
destinatários ÷ 50 por minuto). Duas leituras possíveis:

- **Relativo por destinatário** — cada pessoa recebe 2h após *o seu* envio.
  Exige agendamento por linha, um scheduler por destinatário e reconciliação
  de horário. Muito mais complexo.
- **Absoluto na campanha** — o admin marca uma hora e a campanha inteira sai
  ali.

**Recomendação: absoluto.** A UI calcula a sugestão ("2h após o fim do disparo
original") e preenche o campo, mas o que vai para o banco é um `timestamptz`. A
diferença prática entre as duas leituras é de ~38 min na cauda da base, e não
justifica o custo. Se um dia justificar, o relativo se constrói por cima disso
sem refazer nada.

Como bônus, o absoluto resolve de graça um problema que o relativo teria:
**mandar mensagem às 3h da manhã**. Com hora marcada, o admin vê o horário.

## Modelo de dados

Migration `0041_campanhas_agendamento.sql`:

```
campaigns
+ scheduled_at        timestamptz  -- null = disparo manual (comportamento atual)
+ source_campaign_id  uuid references campaigns(id) on delete set null
+ source_filter       text         -- só documental: qual segmento originou

status ganha 'scheduled'  -- draft|scheduled|validating|ready|sending|paused|completed|failed
```

`source_campaign_id` + `source_filter` não são funcionais — servem para a tela
mostrar "follow-up de: Alunos em Modo Avião · quem clicou no link" e para
auditoria. Sem isso, em três meses ninguém lembra de onde veio aquela base.

## Promoção de agendada → enviando

A função `invoke_campaign_sender_for_active()` (0020, corrigida em 0023) já roda
por `pg_cron` a cada minuto. Ganha um passo **antes** do loop existente:

```sql
update campaigns
set status = 'sending', updated_at = now()
where status = 'scheduled' and scheduled_at <= now();
```

Não precisa de cron novo, nem de Edge Function nova, nem de mudança no
`campaign-sender`. É a mudança de menor superfície possível: a campanha entra no
pipeline de disparo que já existe e funciona.

**Reaproveita de graça** todas as proteções já validadas em produção: claim
atômico (`FOR UPDATE SKIP LOCKED`), pausa automática por teto de tier de
mensageria, reclaim de destinatário preso, recálculo de contadores.

## Público derivado de outra campanha

`POST /api/campaigns/from-segment`:

```
{ sourceCampaignId, filter, name, credentialId, templateName,
  templateLanguage, templateCategory, scheduledAt }
```

Filtros da v1 — todos consultas diretas em `campaign_recipients`, sem tabela
nova:

| filtro | condição |
|---|---|
| `clicked` | `clicked_at is not null` (requer Frente 1) |
| `button_reply` | `button_reply = <texto>` (ex: "Já Comprei!") |
| `delivered_no_engagement` | `status in ('delivered','read') and button_reply is null and clicked_at is null` |
| `failed` | `status = 'failed'` — para retentar com outro template |

O endpoint copia `phone_e164` **e** `variables` do destinatário original — é o
que faz `{{1}}` continuar sendo o primeiro nome no follow-up sem novo CSV.

Reaproveita integralmente o caminho de criação já existente em
[POST /api/campaigns](apps/web/app/api/campaigns/route.ts): dedupe por telefone
(obrigatório — ver a armadilha de `ON CONFLICT` no CLAUDE.md), filtro de
opt-out, `events_log`. **Não duplicar essa lógica**: extrair a parte de "inserir
destinatários numa campanha" para uma função compartilhada e chamar dos dois
endpoints.

## Armadilhas conhecidas

1. **Opt-out precisa ser reavaliado no momento do disparo, não da criação.**
   Uma campanha criada agora e agendada para daqui a 2h pode incluir alguém que
   clicou em "Parar de receber mensagens" nesse intervalo. O filtro atual roda
   só na criação. **O `campaign-sender` precisa checar `whatsapp_opt_outs` no
   claim do lote também** — hoje ele não checa, porque com disparo imediato os
   dois momentos eram o mesmo. Este é o item de compliance da frente, e não é
   opcional.
2. **`created_at` do destinatário ordena o envio** (`claim_campaign_recipients`
   usa `order by created_at`). Campanha derivada herda a ordem da origem — o que
   é bom e não precisa mudar, só não surpreender.
3. **Cancelar uma campanha agendada** precisa existir na UI desde a v1. Marcar
   hora para dali a 2h e não ter botão de desistir é um jeito caro de errar.
   `campaigns-list.tsx` já tem "Excluir" para `draft`/`ready` — estender para
   `scheduled`.

---

# Sprints

### Sprint 1 — Link rastreável (Frente 1)
Migration 0040, endpoint `/c/[token]`, geração de token no cadastro de
destinatário, componente `button` no `campaign-sender`, campo de destino +
aviso de variável no wizard, `clicked_count` no relatório e no CSV.

**Entrega isolada de valor:** mesmo sem a Frente 2, você passa a saber quantas e
quais pessoas clicaram em comprar. Hoje esse número não existe.

### Sprint 2 — Follow-up agendado (Frente 2)
Migration 0041, promoção `scheduled → sending` no cron, checagem de opt-out no
claim do lote, `POST /api/campaigns/from-segment`, UI de "criar follow-up a
partir desta campanha" + cancelamento de agendada.

**Depende da Sprint 1** só para o filtro `clicked`. Os outros três filtros
(`button_reply`, `delivered_no_engagement`, `failed`) funcionam com o que já
existe hoje — a Sprint 2 é entregável sozinha se houver motivo para inverter a
ordem.

### Sprint 3 — Texto livre na janela de 24h (opcional, avaliar depois)
Quem clicou num **quick-reply** mandou uma mensagem inbound e portanto tem
janela de 24h aberta: em +2h dá para mandar texto livre, sem custo de template
de marketing. Quem clicou só no **botão de URL** não tem janela (abrir link não
é mensagem) e continua exigindo template.

Fica fora da v1 por três motivos: exige rastrear a última inbound por telefone,
exige um caminho de envio diferente na Graph API (`type=text`), e a janela pode
ter fechado quando o cron rodar — o que obriga um fallback para template de
qualquer jeito. É otimização de custo sobre uma capacidade que ainda não existe.

**Avaliar com número na mão:** só vale se a fatia de quick-reply for grande o
bastante para a economia pagar a complexidade. Depois da Sprint 1 esse número
existe.

## Métrica de sucesso

Antes: taxa de clique no botão de compra é **desconhecida**.
Depois: taxa de clique por campanha, e taxa de conversão do follow-up medida
contra o público que o originou.
