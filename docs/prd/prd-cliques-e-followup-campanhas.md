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

## O que o "link tracking" nativo da Meta resolve (e o que não resolve)

O editor de template da Meta tem uma caixa "usar o rastreamento de link para
relatar cliques no site". Ela **não substitui** esta frente, mas também não é
enfeite — convém deixar marcada.

O que ela entrega, via Template Analytics (WhatsApp Manager ou Business
Management API): `url_button` (cliques totais) e `unique_url_button` (contas
distintas que clicaram). Agregado por template, por dia. **Nunca identifica o
destinatário** — não vem telefone, não vem nada que permita derivar um público.
Por isso não alimenta a Frente 2.

Limitações da via nativa que o redirect próprio não tem:

- **Dados de clique expiram em 7 dias** — a contagem *zera*, não é arquivada.
- **É por template, não por campanha.** Reusar o mesmo template em dois
  disparos mistura os números; separar só é possível com granularidade diária.
- **Indisponível na UE e no Japão** (irrelevante para o Brasil hoje, mas é uma
  dependência externa que o nosso caminho não carrega).

**Uso recomendado:** manter marcada como **número de conferência independente**
na subida da Frente 1 — serve para validar o nosso contador e, em especial,
para calibrar o filtro de crawler (armadilha 1 abaixo). Divergência grande
entre os dois números aponta bug nosso.

## Objetivo

Duas capacidades, independentes entre si mas que só entregam o caso de uso
completo juntas:

1. **Rastrear o clique no botão de URL** — trocando o link do template por um
   redirect nosso com token por destinatário.
2. **Responder X minutos após o clique**, com uma mensagem pré-configurada,
   por pessoa — e não como um segundo disparo em bloco.

## Fora de escopo

- **Atribuição de venda** (clicou → comprou). Exige integração com o checkout
  (Sympla/etc.), que é outro projeto. O redirect da Frente 1 deixa o caminho
  pronto — carrega UTM — mas fechar o laço não entra aqui.
- **Régua com ramificação condicional** (se clicou A então B, senão C). A v1
  tem uma regra por gatilho, sem árvore.
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

Migration `<timestamp>_campanhas_clique_rastreado.sql` (nome com timestamp:
ver "Trabalho em paralelo" no CLAUDE.md — numeração sequencial em duas
sessões ao mesmo tempo queimou o número 0040):

```
campaigns
+ click_target_url  text          -- destino real do redirect
+ clicked_count     int default 0

campaign_recipients
+ click_token       text          -- unique, gerado no cadastro do destinatário
+ clicked_at        timestamptz   -- primeiro clique
+ click_count       int default 0 -- cliques totais (a pessoa pode voltar)
```

`click_token`: **gerado pelo banco, via `default`** — não pela aplicação:

```sql
click_token text not null default encode(gen_random_bytes(8), 'hex')  -- 16 chars, 64 bits
```

O default no banco não é preciosismo. Há **dois caminhos** de criação de
destinatário: o upsert do `POST /api/campaigns` (CSV) e o `insert ... select` da
materialização de segmento (Frente 2, em SQL puro). Gerar na aplicação obrigaria
a duplicar a lógica nos dois, e a esquecer num deles é justamente o tipo de
falha silenciosa que o CLAUDE.md já documenta. Com `default`, os dois caminhos
ganham token de graça.

Não precisa ser segredo criptográfico — o token não dá acesso a nada, só
identifica uma linha — mas precisa ser não-enumerável, para que ninguém varra
tokens e infle contadores alheios. 64 bits resolve isso com folga.

Índice: `create unique index on campaign_recipients(click_token);`

**O token não entra em `variables`.** Aquele jsonb mapeia 1:1 os placeholders do
BODY por chave numérica ("1", "2", ...) e é consumido por `buildComponents()`.
Injetar o token ali viraria um parâmetro de corpo a mais e quebraria o
alinhamento de todas as variáveis do texto.

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
   {"type":"button","sub_type":"url","index":"<posição do botão>",
    "parameters":[{"type":"text","text":"<click_token>"}]}
   ```
   Sem isso o envio é rejeitado pela Graph API com erro de parâmetro faltando.

   **`index` não pode ser hardcoded como `"0"`.** É a posição do botão entre
   *todos* os botões do template. No template atual a ordem é `Comprar Meu
   Ingresso` (URL, 0) · `Já Comprei!` (1) · `Não Vou Poder Ir!` (2) — dá 0 por
   coincidência de layout. Trocar a ordem dos botões no editor da Meta passaria
   a enviar o token no botão errado, sem erro nenhum: a Graph API aceita, e o
   link sai quebrado para a base inteira. Derivar o índice de
   `campaigns.template_components` (já salvo em jsonb na criação da campanha),
   procurando o botão de sub-tipo URL.

   Regra da Meta, confirmada na doc: **uma só variável por URL, e só no final** —
   o valor enviado é *anexado* como sufixo, não substituído no meio. O desenho
   `https://dominio/c/{{1}}` + token é compatível; qualquer coisa que exigisse a
   variável no meio da URL não seria.

   Detalhe menor a corrigir de passagem: `buildComponents()` é chamado **duas
   vezes** na mesma expressão em [sendOne](supabase/functions/campaign-sender/index.ts#L217).
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

# Frente 2 — Follow-up por gatilho, X minutos após o clique

## A decisão que define o custo

O follow-up é uma mensagem por pessoa, disparada X minutos depois do gatilho.
**Quanto ela custa depende inteiramente de qual botão a pessoa tocou** — e isso
é decisão de desenho do template, não de código:

| Gatilho | Abre a janela de 24h? | Mensagem possível | Custo |
|---|---|---|---|
| Quick-reply ("Quero Comprar!") | **Sim** — o toque é uma mensagem inbound | texto livre | **grátis** |
| Botão de URL (rastreado via `/c/`) | **Não** — abrir link não é mensagem | só template de marketing | **pago, por pessoa** |

Fonte: [doc de pricing da Meta](https://developers.facebook.com/docs/whatsapp/pricing) —
mensagens não-template dentro de uma janela de atendimento aberta são gratuitas.

O mecanismo de agendamento é **o mesmo nos dois casos**. O tipo de botão só
decide se cada mensagem sai de graça ou é cobrada.

### O caminho alternativo: trocar o CTA por quick-reply

Substituir `Comprar Meu Ingresso` (URL) por `Quero Comprar!` (quick-reply):

```
disparo (template pago, 1x)
   ↓ pessoa toca "Quero Comprar!"     → abre a janela de 24h
resposta imediata com o link          → grátis   (regra com delay = 0)
   ↓ X minutos depois
lembrete "seu ingresso ainda te espera"  → grátis
```

Custo do follow-up cai a zero. Rastreamento fica **melhor**, não pior: o toque
no quick-reply já é capturado hoje em `campaign_recipients.button_reply`
(migration 0022), e o link enviado na resposta pode ser o `/c/` da Frente 1 —
então dá para separar *"pediu o link"* de *"abriu o checkout de fato"*, coisa
que o botão de URL puro nunca deu.

**O preço disso é um toque a mais antes do checkout.** É fricção real e vai
custar alguma conversão no topo. Contra: a base já está acostumada a tocar
botão nesse template ("Já Comprei!", "Não Vou Poder Ir!").

**Decisão do fundador, não técnica.** As duas opções estão implementadas pelo
mesmo código; o que muda é o template e o custo. Dá para medir: rodar um
disparo com cada desenho e comparar cliques no checkout contra custo total.

## O que já existe (e não precisa ser construído)

Levantamento do código atual — a Frente 2 é bem menor do que parece:

| Peça | Situação |
|---|---|
| Envio de texto livre | **Pronto** — `sendFreeformTextMessage` ([graphClient.ts](apps/web/lib/whatsapp-cloud/graphClient.ts#L192)) e `enviarTexto` no flow-engine |
| Detecção de janela fechada | **Pronto** — `FORA_DA_JANELA_CODE` (131047), já tratado como evento próprio no [flow-engine](supabase/functions/flow-engine/index.ts#L911) |
| Resposta automática a inbound do Cloud API | **Pronto** — flow-engine, em produção desde 04/09/2026 |
| Captura do toque em quick-reply | **Pronto** — `linkButtonReplyToRecipient` no [whatsapp-cloud-webhook](supabase/functions/whatsapp-cloud-webhook/index.ts#L400) |
| Envio de template em lote, com claim atômico e teto de tier | **Pronto** — `campaign-sender` |
| Captura do clique em link | Frente 1 (Sprint 1) |
| **Fila com atraso por pessoa** | **É isto que falta** |

**Não é preciso checar a janela de 24h antes de enviar.** A Graph API é a
autoridade: tenta o texto livre e, se voltar 131047, a janela estava fechada.
Manter um `last_inbound_at` nosso seria uma segunda fonte de verdade capaz de
divergir — e o código já sabe reconhecer esse código de erro.

## Modelo de dados

Migration `0041_follow_up_por_gatilho.sql`. Nomes em inglês para manter a
coerência do módulo de campanhas (`campaigns`, `campaign_recipients`) — o
vocabulário em português dos Flows é de outro módulo.

```
campaign_follow_ups            -- a REGRA, pré-configurada pelo admin
  id, tenant_id, campaign_id, active
  trigger         text   -- 'button_reply' | 'link_click'
  trigger_value   text   -- texto do botão, quando trigger='button_reply'
  delay_minutes   int    -- 0 = responder na hora
  mode            text   -- 'freeform' | 'template'
  body            text   -- quando freeform
  template_name / template_language / template_category   -- quando template
  cancel_on_button_reply  text[]   -- ex: {'Já Comprei!'}
  quiet_hours_start / quiet_hours_end   -- ver armadilha 3

scheduled_messages             -- a FILA
  id, tenant_id, follow_up_id, campaign_recipient_id, credential_id,
  phone_e164, send_after timestamptz,
  status  text  -- pending|sending|sent|cancelled|window_closed|failed
  claimed_at, attempts, wamid, sent_at, error
  unique (follow_up_id, campaign_recipient_id)
```

`delay_minutes = 0` faz a mesma regra cobrir a resposta imediata com o link e o
lembrete de X minutos — são duas linhas em `campaign_follow_ups`, não dois
mecanismos.

## Fluxo

**Enfileiramento** — dois pontos, ambos em código que já existe:

- `whatsapp-cloud-webhook`, logo após `linkButtonReplyToRecipient()`:
  gatilho `button_reply`.
- `/c/[token]`, logo após registrar o clique: gatilho `link_click`.

Ambos fazem `insert ... on conflict do nothing`. É o `unique (follow_up_id,
campaign_recipient_id)` que garante que **cinco cliques da mesma pessoa geram um
follow-up, não cinco**.

**Envio** — Edge Function `follow-up-sender`, invocada por `pg_cron` a cada
minuto, no mesmo desenho já validado do `campaign-sender`:

```
1. claim de lote com FOR UPDATE SKIP LOCKED  (send_after <= now(), status='pending')
2. cancelar quem: entrou em whatsapp_opt_outs, ou respondeu algum
   cancel_on_button_reply depois do enfileiramento  → status 'cancelled'
3. fora da faixa de horário permitida → empurra send_after, não envia
4. mode='freeform' → sendFreeformTextMessage
   mode='template' → mesmo caminho do campaign-sender
5. erro 131047 → status 'window_closed' (NÃO é falha — ver armadilha 2)
6. events_log em toda tentativa (follow_up_send_attempt)
```

## Ainda cabe a campanha derivada agendada?

Sim, para um caso que o gatilho não cobre: **quem não fez nada**. Não houve
clique nem resposta, logo não há gatilho por pessoa nem janela aberta — só resta
um disparo em bloco, com template, para o segmento `delivered_no_engagement`.

Isso é a Sprint 4, não a v1: é o público de menor intenção e o mais caro de
alcançar. Fazer por último é a ordem certa.

## Armadilhas conhecidas

1. **Cancelamento é a regra mais importante deste desenho, e ela é de produto,
   não técnica.** Mandar "não esqueça de comprar" para quem já comprou é pior
   do que não mandar nada — queima a lista e gera bloqueio, que é o insumo do
   score de qualidade da Meta. Sem integração com o checkout, o único sinal
   disponível é a pessoa ter tocado "Já Comprei!" — daí `cancel_on_button_reply`
   existir desde a v1, e não como refinamento futuro.
2. **131047 (fora da janela) não é falha, é estado.** Tratado como erro comum,
   entraria no retry de 3 tentativas e queimaria as três à toa — a janela não
   reabre sozinha. Precisa de status próprio (`window_closed`), que também vira
   métrica: quanta gente demorou demais.
3. **X minutos após o clique pode cair às 3h da manhã.** O agendamento absoluto
   descartado antes resolvia isso de graça, porque o admin via a hora; o
   relativo, não. Faixa de horário permitida é **obrigatória** na v1 — fora
   dela, empurra `send_after` para o próximo horário válido em vez de enviar.
4. **`delay_minutes` maior que 24h torna `freeform` impossível** — a janela já
   terá fechado. A UI deve limitar o campo, não deixar o admin descobrir isso
   pelo relatório de `window_closed`.
5. **A regra pertence à campanha, mas o gatilho chega pelo webhook**, que é
   público e sem sessão de usuário. O enfileiramento roda com service role,
   como o resto do webhook — vale a mesma disciplina de checar e logar `error`
   em todo insert (armadilha da falha silenciosa, no CLAUDE.md).

---

# Sprints

### Sprint 1 — Link rastreável (Frente 1)
Migration 0040 (colunas + `default` do token + `clicked_count` no
`recompute_campaign_counters`), endpoint `/c/[token]`, componente `button` com
índice derivado no `campaign-sender`, campo de URL de destino + aviso de
variável no wizard, `clicked_count` no relatório e no CSV.

**Entrega isolada de valor:** mesmo sem a Frente 2, você passa a saber quantas e
quais pessoas clicaram em comprar. Hoje esse número não existe.

### Sprint 2 — Follow-up por gatilho (Frente 2)
Migration 0041, Edge Function `follow-up-sender` + cron, enfileiramento nos dois
gatilhos, tela de regra de follow-up dentro da campanha, faixa de horário
permitida, relatório com `sent` / `cancelled` / `window_closed`.

**Só depende da Sprint 1 para o gatilho `link_click`.** O gatilho
`button_reply` funciona com o que já está em produção hoje — então, se o
caminho escolhido for o do quick-reply, **a Sprint 2 pode vir primeiro e a
Frente 1 vira complemento de medição**, não pré-requisito.

### Sprint 3 — Campanha derivada agendada
Público `delivered_no_engagement` (quem recebeu e não fez nada): não há gatilho
por pessoa nem janela aberta, então é disparo em bloco com template pago, com
`scheduled_at` e público materializado no momento do disparo.

Por último de propósito: é o público de menor intenção e o de alcance mais caro.

## Métrica de sucesso

Antes: taxa de clique no botão de compra é **desconhecida**.

Depois, por campanha: cliques (totais e únicos), follow-ups enviados,
cancelados por "Já Comprei!", perdidos por janela fechada — e o **custo por
follow-up entregue**, que é o número que decide se o caminho do quick-reply
vale a fricção do toque a mais.
