# PRD: Automação de resposta por Flow — wa-intelligence

## Contexto

O wa-intelligence hoje captura e guarda mensagens (governança/inteligência), e tem um
módulo de campanhas (Cloud API oficial) que dispara templates e recebe respostas na
caixa compartilhada — mas sem responder nada automaticamente.

O que falta: quando um lead responde fora do roteiro da campanha (pergunta sobre
meia-entrada, horário, reembolso etc.), hoje isso só é capturado e visível — não é
direcionado a lugar nenhum. A decisão já tomada é não usar IA (Meta Business Agent)
pra isso — resolver por regra fixa (keyword → link de FAQ), sem geração de texto livre.

## Priorização entre perspectivas (decisão do fundador)

Este PRD passou por uma análise sob várias lentes (dev sênior, PM, marketing, artista,
CEO) antes de virar plano de execução. Prioridades definidas:

- **Dev e marketing: prioritários** — os ajustes abaixo (spike de criptografia isolado,
  motor de decisão em função separada, chave do Flow fora de texto plano, cadastro de
  número como entrega real, e boas-vindas/fallback como trabalho de copywriting, não
  campo de banco) já estão incorporados nas seções seguintes.
- **Riscos da lente CEO — aceitos conscientemente:** custo de oportunidade frente ao
  próximo item do roadmap de inteligência (alertas semânticos), dependência de
  cronograma com o painel-shows, acúmulo de exceções ao posicionamento de "não virar
  atendimento", e ausência de uma análise formal de custo-benefício antes de começar.
  Nenhum bloqueia o início do desenvolvimento — ficam registrados aqui pra não serem
  re-litigados a cada sessão.
- **Considerações da lente artista — secundárias nesta fase:** risco de quebra de
  persona num fallback genérico, e falta de visibilidade do artista sobre o que é dito
  em seu nome. A primeira é mitigada de forma incidental pelo processo de copywriting
  abaixo; a segunda fica sem tratamento dedicado por ora.

## Objetivo

Construir uma camada self-service dentro do wa-intelligence que permita, sem tocar em
código, banco ou n8n:

- Anexar uma ou mais automações ("Flows") a um número WhatsApp Cloud API
- Cada Flow define: mensagem de boas-vindas (1º contato, reforça o escopo do canal),
  uma lista de keyword → resposta, e uma mensagem de fallback
- Criar, editar e desativar Flows e keywords pela interface
- `tipo` de Flow é extensível — nesta fase já entram dois tipos: `keyword_automation`
  (acima) e `agenda_shows` (WhatsApp Flow nativo, endpoint dinâmico que consulta a
  agenda de shows em tempo real)
- Construir uma base de clientes própria (nome, e-mail, telefone), tenant-wide e não
  presa a um Flow — o embrião de um CRM. Quem chega por fora, sem cadastro prévio
  (provavelmente contato compartilhado), tem esses dados coletados antes de qualquer
  outra interação

## Fora de escopo (nesta fase)

- IA gerando resposta livre (Meta Business Agent ou qualquer outra) — decisão já tomada
- Inbox de atendimento com status/atribuição de conversa — o produto continua não sendo
  ferramenta de atendimento além do que já foi aberto para campanhas
- Outros tipos de WhatsApp Flow além de `agenda_shows` (ex: formulário de cadastro,
  pesquisa) — ficam preparados pelo modelo de dados, mas fora desta primeira entrega
- Teste A/B de variantes de boas-vindas/fallback — `mensagem_boas_vindas` fica única
  por Flow nesta entrega; não bloqueia expansão futura, mas não é escopo agora

## Pré-requisito: nota de posicionamento no CLAUDE.md

Antes do primeiro PR, adicionar uma entrada no CLAUDE.md no mesmo formato usado para o
módulo de campanhas ("Reabertura parcial e consciente"): data, decisão do fundador, por
que é aditiva, o que continua fora do escopo. É essa nota que mantém o Claude Code (e
qualquer dev) dentro do combinado durante as sessões de código, sem precisar
re-litigar posicionamento a cada vez.

## Caminho recomendado: duas etapas, sem esperar o painel-shows

Pra não travar a entrega no cronograma de outro app (painel-shows ainda está
redefinindo sua própria origem de dados), o Flow `agenda_shows` nasce em duas etapas
que compartilham a mesma tabela e o mesmo endpoint — só muda quem preenche o dado:

- **V1 (esta entrega):** `agenda_shows_sync` é preenchida manualmente, por um
  formulário na própria tela de gestão de Flows (cadastrar show, cidade, data, status,
  link). Mesmo padrão que o dashboard de vendas já usou — começa manual, automatiza
  depois. Não fere a regra de ponte entre apps, porque não é integração nenhuma: é
  cadastro dentro do próprio wa-intelligence.
- **V2 (quando o painel-shows tiver API interna pronta):** a mesma tabela passa a ser
  preenchida por um job de sincronização em vez do formulário — endpoint do Flow não
  muda nada. É nesse momento que a ponte formal (ADR + schema `integrations`) entra.

Trade-off da V1: a agenda pode ficar defasada em relação ao painel-shows se alguém
esquecer de atualizar manualmente — é risco operacional, não técnico.

## Dependência cruzada (V2): dado de agenda vem do painel-shows

A agenda de shows (data, cidade, teatro, status de venda) já é dado de propriedade do
app `painel-shows` (fonte de verdade: monday.com, Sympla, upload de ticketeira) — não
existe outra fonte pra isso no monorepo. Pela regra já fixada (ADR 0006 do
plauz-core): só existe ponte entre apps quando um segundo app nomeado precisa do
mesmo dado — é exatamente o que está acontecendo agora.

Forma já decidida pra esse caso: schema `integrations`, credencial isolada com RLS
deny-all, modo **sincroniza e serve** — o wa-intelligence nunca consulta o
painel-shows (nem monday/Sympla) ao vivo na hora que o WhatsApp abre o Flow. Um job
periódico sincroniza uma cópia mínima (show, cidade, data, status, link) pro schema
local do wa-intelligence; o endpoint do Flow só lê essa cópia. Isso também é
necessário porque endpoints de WhatsApp Flow têm exigência de resposta rápida —
depender de uma chamada viva ao painel-shows (que por sua vez depende de
monday/Sympla) quebraria esse requisito de latência.

Isso vira um ADR próprio
(`docs/decisions/<NNNN>-integracao-painel-shows-wa-intelligence.md`), seguindo o
mesmo padrão do ADR 0006.

## Modelo de dados

Segue as convenções já fixadas: `tenant_id` em toda tabela, `deleted_at` + view
`<tabela>_ativos`, RLS habilitado, nomes em português snake_case.

**Correção pós-migration real (descoberta pelo Claude Code inspecionando o repo, não
suposição do PRD):** o repo não tem nenhuma view `_ativos` — `deleted_at` só existe em
`messages`, e ali significa "apagada no WhatsApp", não o padrão de soft-delete que o
PRD assumiu. Mantém a coluna `deleted_at`, mas sem criar view — filtro
`deleted_at is null` direto nas queries + índice parcial. `tipo` (enum) também não
tem `create type` em lugar nenhum do projeto — é sempre `text + check (... in (...))`,
mantido assim aqui. Timestamps padronizados pra `created_at`/`updated_at` (inglês,
igual ao resto do schema) — só os campos de domínio (`nome`, `telefone`, `email`,
etc.) ficam em português.

**RLS por sessão pra Flow, sem inventar modelo novo:** `has_session_access()` recebe
`wa_sessions.id`, mas Flow é escopado a `whatsapp_cloud_credentials`. A migration 0021
já criou a ponte (`wa_sessions.cloud_credential_id`, único — 1 sessão por credencial),
então a função `has_cloud_credential_access(p_credential_id)` reaproveita
`has_session_access()` por trás. `whatsapp_flows` e `flow_palavras_chave` usam essa
função no RLS (select/insert/update; delete é admin-only por simetria com regra 21) —
resolve o teste "operator sem acesso ao número não vê nem edita o Flow dele" sem
modelo de acesso novo.

**`whatsapp_flows`**
`id, tenant_id, cloud_credential_id (FK whatsapp_cloud_credentials), artista (texto, escopado por tenant — não referencia o app "artists" do plauz-core, porque o wa-intelligence é multi-tenant e atende clientes fora da Plauz), nome, tipo (enum — 'keyword_automation' ou 'agenda_shows'), ativo, mensagem_boas_vindas, mensagem_fallback, criado_em, deleted_at`

**`clientes`** (tenant-wide, não escopada a um Flow — é a base que evolui pra CRM)
`id, tenant_id, nome, email, telefone (chave de dedupe, E.164, UNIQUE por tenant_id — upsert com conflict na criação, pra evitar corrida entre mensagens quase simultâneas), origem (enum — 'campanha' ou 'organico'), cadastro_completo (bool), aguardando_campo (enum — 'nome' ou 'email', nulo quando completo), tentativas_campo_atual (smallint, zerado ao avançar de campo — controla o degrade após 2 tentativas), pulou_cadastro (bool — true quando completou por degrade, não por ter respondido), gate_iniciado_por_flow_id (FK whatsapp_flows, nulo — registra qual Flow abriu o gate primeiro; ver nota sobre gate duplo abaixo), mensagem_pendente (texto, nulo — guarda a mensagem original que disparou o primeiro contato, pra ser respondida assim que o cadastro completar, em vez de se perder), criado_em, atualizado_em, deleted_at`

Validação de `nome`: mínimo 2 caracteres, no máximo 60, rejeita string vazia/só
números/só símbolos, **e rejeita qualquer resposta que pareça uma frase/pergunta**
(contém "?", ou mais de 5 palavras) — sem isso, uma pergunta real mandada durante o
gate (ex: "quero saber sobre o show de sábado") passaria como nome válido. Mesma
lógica de rejeição se aplica a qualquer resposta durante o gate.

Mensagens adicionais durante o gate: se a pessoa manda mais de uma mensagem antes de
completar o cadastro, e a mensagem não passa na validação do campo esperado, ela é
**concatenada em `mensagem_pendente`** (não descartada, não interpretada à força como
resposta) — nada que a pessoa perguntou se perde, mesmo que ela mande várias coisas
fora de ordem antes de responder nome/e-mail de verdade.

Retry de `pulou_cadastro`: reaproveita o mesmo gatilho do reset de 14 dias (mesma
tabela `flow_contato_estado`) — na próxima vez que esse contato disparar uma
boas-vindas nova (por inatividade), se `pulou_cadastro=true` e o campo que faltou
ainda está nulo, o gate tenta de novo só esse campo, em vez de aceitar a lacuna pra
sempre.

**Risco aceito (não corrigido):** se a mesma pessoa contata dois números diferentes
quase ao mesmo tempo pela primeira vez, os dois `flow-engine` podem disparar o gate
em paralelo antes de `gate_iniciado_por_flow_id` estar gravado, mandando "qual seu
nome?" dos dois canais. É raro (exige duas primeiras mensagens quase simultâneas em
números diferentes) e resolver de verdade exigiria coordenação entre canais que não
compensa o esforço agora — aceito conscientemente, não implementado.

**Exclusão real de PII (não é o `deleted_at` padrão do resto do projeto):** `clientes`
guarda nome e e-mail — se alguém pedir exclusão (direito já prontamente exercitável
sob LGPD), soft-delete não é suficiente, o dado continua existindo. Precisa de uma
ação de admin que apague de verdade `nome`/`email` (mantendo só `telefone` e o
histórico de mensagens, que já segue a governança do resto do projeto) — não é o
mesmo botão "excluir" usado em outras tabelas.

Regra de preenchimento: telefone achado em `campaign_recipients` de **qualquer**
campanha cujo `credential_id` bata com o número (não "a" campanha, no singular — um
número pode ter rodado várias campanhas ao longo do tempo) → `origem='campanha'`,
`cadastro_completo=true` de cara. Telefone não encontrado em nenhuma → `origem='organico'`,
`cadastro_completo=false`, `aguardando_campo='nome'`, `mensagem_pendente` = o texto
que a pessoa mandou — é esse caso que dispara a coleta obrigatória antes de qualquer
outra resposta.

**`flow_palavras_chave`**
`id, tenant_id, flow_id (FK), palavra_chave, tipo_resposta (enum — 'texto', 'link', ou 'abrir_flow'), resposta (texto ou link quando aplicável), flow_destino_id (FK whatsapp_flows — validado por constraint/aplicação pra sempre apontar a um Flow ativo do tipo 'agenda_shows' no mesmo cloud_credential_id, nunca de outro número), criado_em, deleted_at`

**Constraint pra evitar ambiguidade:** índice único em `whatsapp_flows (cloud_credential_id, tipo) WHERE ativo = true AND deleted_at IS NULL` — o `deleted_at IS NULL` foi um fix do Claude Code sobre o PRD original: sem ele, um Flow soft-deletado mas ainda `ativo=true` bloquearia a criação do substituto. Impede dois Flows do mesmo tipo ativos ao mesmo tempo no mesmo número.

**Constraint que não estava no PRD, adicionada na revisão do Claude Code:** `unique (flow_id, lower(palavra_chave)) WHERE deleted_at IS NULL` em `flow_palavras_chave` — duas keywords idênticas no mesmo Flow tornariam o match não-determinístico.

**`flow_contato_estado`**
`id, tenant_id, flow_id (FK), contato_telefone, recebeu_boas_vindas (bool), fallbacks_consecutivos (smallint, zerado a cada keyword batida ou boas-vindas — sustenta o alerta "N fallbacks seguidos" que já estava descrito como mitigação mas nunca tinha campo pra existir; N=3 como ponto de partida, ajustável), pausado_aguardando_humano (bool — true quando o alerta de fallback dispara; enquanto true, `flow-engine` só captura, não responde automaticamente; zera quando uma keyword bate ou um humano intervém), atualizado_em`

`tenant_id` explícito em `flow_palavras_chave` e `flow_contato_estado` — regra 1 do
CLAUDE.md é "em toda tabela, sem exceção"; depender de join através de `whatsapp_flows`
pra filtrar por tenant no RLS é o desvio que a regra existe pra evitar.

Decisão fechada: `recebeu_boas_vindas` reseta após 14 dias de inatividade (mesmo
padrão do greeting message nativo do WhatsApp Business App) — não é permanente. A
checagem é `atualizado_em` há mais de 14 dias, não um campo de expiração à parte.

**`agenda_shows_sync`** (preenchida manualmente via interface na V1; job de
sincronização a partir do painel-shows na V2, sem mudar a tabela)
`id, tenant_id, show_id_origem (referência ao painel-shows, nulo na V1), artista, cidade, teatro, data_show, status_venda, link_compra, atualizado_em`

**Chave privada do Flow (criptografia)** — nunca em `integrations.config` nem em env
var por tenant (ponto do dev sênior: repetir esse padrão aqui seria pior que a dívida
já registrada do BYOK, porque é chave privada, não uma API key). Mesmo desenho já
usado pro segredo do `pg_cron` (`internal_secrets`, migration `0023`, RLS deny-all,
lida só por função `security definer` server-side).

**Acesso a `clientes` (decisão fechada):** é tenant-wide, não por número — o modelo
de acesso do projeto inteiro é por sessão (`has_session_access`, regra 20). Confirmado:
**admin-only** — sem nenhuma policy de SELECT pra operator, de propósito. A "visão
contextual" do operator não é uma rota nova: é a tela de chat que já existe
(`chat-view.tsx`), que já mostra a mensagem crua trocada — incluindo nome/e-mail
respondidos durante o gate, como texto normal de conversa. Se um dia quiserem uma
ficha de cliente de verdade dentro da tela de chat, isso é feature nova (rota
server-side com `createAdminClient()` checando `has_session_access` do chat antes de
resolver telefone → cliente) — não faz parte desta entrega.

**Validação de `flow_destino_id` (decisão fechada):** trigger de banco, não só
aplicação — mesmo princípio já usado na constraint de "um Flow ativo por tipo"
(garantia no banco, não confiança na lógica). Como `abrir_flow` fica bloqueado até a
Trilha B de qualquer forma, o custo de implementar certo agora é baixo; o de
descobrir errado em produção não é.

**Lock durante o gate:** mensagens quase simultâneas do mesmo telefone durante a
coleta (ex: "João" e "joao@x.com" em sequência rápida) precisam ser processadas em
ordem, não em paralelo — lock consultivo do Postgres por telefone (ou um campo
`processando` com timeout curto) durante os passos do gate, pra não avaliar a
resposta errada contra o campo errado.

Flows são escopados a números Cloud API (`whatsapp_cloud_credentials`) — não a sessões
Evolution. Isso mantém o pipeline de governança (captura de conversas internas)
totalmente intocado; só estende o pedaço que já era exceção documentada (campanhas).

## Fluxo técnico

**Regra de isolamento obrigatória:** `flow-engine` roda com service role, processando
o webhook compartilhado de todos os tenants (um único Meta App, como o resto do
projeto já documenta) — não tem contexto de usuário autenticado, então o RLS não
protege sozinho. Mesma exceção já registrada na regra 15 do CLAUDE.md pra leitura de
`integrations`: **toda query em `clientes`, `campaign_recipients`,
`flow_palavras_chave`, `flow_contato_estado` e `whatsapp_opt_outs` precisa de
`.eq('tenant_id', ...)` explícito**, derivado do `cloud_credential_id` resolvido a
partir do `phone_number_id` do payload — nunca de um campo que viaje solto entre
funções. Sem isso, um bug de query vaza dado entre tenants inteiros, não só entre
artistas do mesmo tenant.

0. Idempotência: verifica se `message_id` já foi processado (upsert com conflict) —
   se sim, ignora e encerra aqui
1. Mensagem inbound chega no `whatsapp-cloud-webhook` (já existe, sem mudança na captura)
2. Salva em `messages` normalmente (governança) — essa função não ganha nenhuma
   responsabilidade nova
3. Ao final, dispara uma função nova e separada, `flow-engine` — decisão explícita do
   dev sênior: motor de decisão isolado da função de captura, mesmo padrão de
   `campaign-sender` ficar separado do webhook de campanhas, não misturado nele.
   **Não é fire-and-forget:** grava em `events_log` (`flow_engine_disparado`) antes de
   invocar; se a invocação falhar, isso fica visível pra debug em vez de silencioso —
   mesmo espírito da regra 6 do CLAUDE.md, aplicado à invocação em si, não só aos
   inserts de dentro dela
3.5. **Checagem de opt-out, antes de qualquer envio automático (gate, boas-vindas,
   keyword ou fallback):** telefone em `whatsapp_opt_outs` → não manda nada
   automaticamente, nem o gate de cadastro. É o mesmo dado que o módulo de campanhas
   já usa — nunca tinha sido conectado ao `flow-engine`
4. Antes de qualquer Flow: busca `clientes` por telefone (com `tenant_id` explícito
   na query, ver regra de isolamento acima). Não existe → checa `campaign_recipients`
   de **qualquer** campanha cujo `credential_id` bata com o número (não uma campanha
   singular) — achou → cria com `origem='campanha'`, `cadastro_completo=true`; não
   achou → cria com `origem='organico'`, `cadastro_completo=false`,
   `aguardando_campo='nome'`, `mensagem_pendente` = o texto recebido agora, **e
   `gate_iniciado_por_flow_id` = o Flow que recebeu essa mensagem** (campo criado na
   rodada anterior pra documentar o risco do gate duplo, mas que nunca era de fato
   gravado em lugar nenhum até agora)
5. `cadastro_completo=false` → conduz a coleta (pergunta nome, depois e-mail, com
   validação leve). Resposta inválida ou ignorada → repergunta e soma
   `tentativas_campo_atual`; na 2ª tentativa falha do mesmo campo, avança mesmo assim
   com esse campo nulo, zera o contador, e marca `pulou_cadastro=true` — nenhum campo
   trava a conversa para sempre. Quando completa (com ou sem degrade): usa
   `mensagem_pendente` (não a última resposta do gate) como se fosse a mensagem
   recebida agora, segue pro passo 6, e limpa `mensagem_pendente`. Mensagem recebida
   durante o gate que não é texto (áudio, figurinha, imagem) → reprompt genérico
   pedindo texto, conta como tentativa, mas não é interpretada como resposta válida
6. Busca o Flow ativo pro `cloud_credential_id` daquele número (garantido único pela
   constraint acima). **Se não houver nenhum Flow ativo pro número** (recém-cadastrado
   sem automação configurada ainda, ou desativado de propósito): encerra sem mandar
   nada, loga em `events_log` (`sem_flow_ativo`) — não trava, não força fallback
   genérico sem contexto. Contato sem linha em `flow_contato_estado`, ou com linha
   cujo `atualizado_em` passou de 14 dias → manda boas-vindas e grava/atualiza o
   estado — **e continua no mesmo turno**: roda a mensagem (a recebida agora, ou a
   `mensagem_pendente` recuperada no passo 5) contra `flow_palavras_chave` também,
   mandando a resposta correspondente (ou fallback) logo em seguida. Boas-vindas nunca
   substitui a resposta à pergunta feita — é aditiva
7. Contato já tinha recebido boas-vindas dentro dos 14 dias → **se
   `pausado_aguardando_humano=true` (ver abaixo), não manda nada automático, só
   captura** — senão, compara o texto com `flow_palavras_chave` — bate → manda a
   resposta mapeada (texto ou link via envio normal; **`abrir_flow` depende de
   capacidade nova, ver nota abaixo**), zera `fallbacks_consecutivos`; não bate →
   manda o fallback, soma `fallbacks_consecutivos`, e ao atingir 3 dispara o alerta
   **e marca `pausado_aguardando_humano=true`** — alertar sem parar de mandar o mesmo
   fallback genérico não ajuda ninguém; um humano (ou uma keyword que bate depois)
   destrava. **Mensagem que é clique de botão de template (rastreado
   por `campaign_recipients.button_reply`) nunca entra nessa comparação de texto** —
   já é tratada pelo módulo de campanhas, evita resposta duplicada/sem sentido
8. Envio de texto/link reaproveita `lib/whatsapp-cloud/graphClient.ts` (já usado pelo
   `campaign-sender`). **Erro de teto de tier de mensageria (códigos
   130472/131048/131056, já documentados e tratados pelo `campaign-sender`)**: o
   `flow-engine` nunca herdava esse cuidado — corrigido, mesmo tratamento: não tenta
   de novo às cegas, loga o caso em `events_log` (`flow_reply_tier_limit`). **
   `tipo_resposta='abrir_flow'` não reaproveita nada existente** — mandar um Flow
   nativo dentro de uma conversa exige montar uma mensagem interativa com token de
   Flow, formato que o `graphClient.ts` de hoje nunca precisou gerar (foi feito pra
   template e mídia). Essa capacidade entra como parte da Trilha
   B (junto do spike de criptografia), não da Trilha A — `abrir_flow` só fica
   disponível de fato depois que a Trilha B validar isso
9. Mensagem enviada pela automação também grava em `messages` (histórico completo) e em
   `events_log` (`flow_reply_sent`, regra 6 do CLAUDE.md)

**Fluxo do tipo `agenda_shows` (endpoint dinâmico do WhatsApp Flow):**

1. V1: dado inserido manualmente pela interface de gestão de Flows. V2: job periódico
   sincroniza `agenda_shows_sync` a partir da API interna do painel-shows
2. Lead abre o Flow (botão dentro da campanha) → Meta chama o endpoint do
   wa-intelligence a cada troca de tela
3. Endpoint lê só `agenda_shows_sync` (filtrado pelo artista da campanha) — nunca chama
   painel-shows/monday/Sympla na hora, nem na V1 nem na V2
4. Endpoint implementa a criptografia exigida pelo WhatsApp Flows (chave pública do
   negócio + canal de dados) — superfície técnica nova, não existe hoje no CLAUDE.md

## Simulação de cenários (rodada 6 — isolamento e consistência interna)

1. **`flow-engine` sem isolamento de tenant explícito nas queries** — roda com
   service role pra todos os tenants, o que torna o RLS insuficiente sozinho (mesma
   exceção já registrada na regra 15 do CLAUDE.md). O achado mais grave até agora:
   sem `.eq('tenant_id', ...)` explícito, um bug de query vazaria dado entre tenants
   inteiros. Corrigido: regra de isolamento explícita no início do fluxo técnico.
2. **`gate_iniciado_por_flow_id` criado na rodada 5, nunca gravado em lugar nenhum**
   — mesma classe de bug da rodada 3 (campo/decisão documentado sem virar passo do
   fluxo). Corrigido: gravado no passo 4.
3. **Alerta de fallback disparava e o bot continuava respondendo a mesma coisa pra
   sempre** — corrigido: `pausado_aguardando_humano` pausa a resposta automática até
   uma keyword bater ou um humano agir.
4. **Aviso de LGPD do gate nunca teve dono** — ficou só como frase num risco.
   Corrigido: entra no mesmo processo de copywriting do resto do conteúdo, Sprint A2.
5. **Teto de tier de mensageria da Cloud API, já tratado pelo `campaign-sender`,
   nunca foi herdado pelo `flow-engine`** — corrigido: mesmo tratamento (loga, não
   tenta às cegas).

## Simulação de cenários (rodada 5 — compliance e validação de dado)

1. **Sem mecanismo de exclusão real de PII** — soft-delete (`deleted_at`) não
   satisfaz um pedido de exclusão de verdade. Corrigido: requisito de ação de admin
   que apaga nome/e-mail de fato, separado do padrão de exclusão do resto do projeto.
2. **`whatsapp_opt_outs` nunca conectado ao `flow-engine`** — alguém que pediu pra
   não receber mais mensagens da Plauz continuaria recebendo automação. Corrigido:
   checagem de opt-out antes de qualquer envio automático, inclusive o gate.
3. **Validação de nome aceitava a pergunta real da pessoa como se fosse o nome** —
   "quero saber sobre o show de sábado" passava na validação da rodada anterior.
   Corrigido: rejeita frases (contém "?" ou mais de 5 palavras).
4. **Mensagens extras durante o gate se perdiam ou contaminavam campos** — só a
   primeira mensagem virava `mensagem_pendente`; as seguintes eram avaliadas (errado)
   como resposta ao campo esperado. Corrigido: mensagem que não valida pro campo
   esperado é concatenada em `mensagem_pendente`, não descartada nem forçada.
5. **Sem Flow ativo pro número, comportamento nunca foi definido** — número novo sem
   automação configurada, ou desativado por engano. Corrigido: encerra sem mandar
   nada, loga o caso, não força fallback sem contexto.

## Simulação de cenários (rodada 4 — falhas de infraestrutura e dado)

1. **`flow-engine` podia falhar em silêncio** — se a invocação falhasse depois do
   webhook já ter respondido 200 pra Meta, ninguém saberia. Corrigido: log em
   `events_log` antes de invocar, não mais fire-and-forget puro.
2. **Duas primeiras mensagens quase simultâneas pra dois números diferentes disparam
   o gate duas vezes** — raro, envolve coordenação entre canais que não compensa o
   esforço agora. **Aceito conscientemente, não corrigido.**
3. **Contador de fallback consecutivo existia só como texto de mitigação, nunca como
   campo** — o alerta "depois de N fallbacks" não tinha como ser implementado.
   Corrigido: `fallbacks_consecutivos` em `flow_contato_estado`, N=3 de partida.
4. **`nome` sem nenhuma validação** — aceitava qualquer string, contaminando a base
   que é o próprio objetivo do projeto. Corrigido: mínimo 2 caracteres, rejeita
   vazio/só número/só símbolo.
5. **`pulou_cadastro=true` era permanente, sem nova tentativa** — minava o objetivo
   de ter uma base completa. Corrigido: reaproveita o reset de 14 dias como gatilho
   natural pra tentar de novo só o campo que faltou.

## Simulação de cenários (rodada 3 — revisando as próprias correções)

1. **O documento se contradizia** — a correção da rodada 2 mudou o schema pra
   "qualquer campanha", mas o fluxo técnico ainda dizia "a campanha" (singular).
   Corrigido — os dois agora dizem a mesma coisa.
2. **Duas tabelas novas sem `tenant_id`** — `flow_contato_estado` e
   `flow_palavras_chave` violavam a regra 1 do CLAUDE.md ("em toda tabela, sem
   exceção"). Corrigido — `tenant_id` explícito nas duas.
3. **`clientes` sem controle de acesso** — é tenant-wide, mas o projeto inteiro
   controla acesso por sessão (regra 20); sem isso, operator restrito a um número
   veria PII de clientes de outro artista. Corrigido como proposta padrão: sem tela
   de listagem geral pra operator nesta entrega, só visão contextual via
   `messages`/`chats` já restrita — a confirmar.
4. **`abrir_flow` tratado como se fosse mandar texto** — abrir um Flow nativo dentro
   da conversa exige mensagem interativa com token de Flow, capacidade que
   `graphClient.ts` nunca teve. Corrigido: movido pra depender da Trilha B, não mais
   assumido como reaproveitamento trivial da Trilha A.
5. **Corrida dentro do próprio gate** — a correção anterior travava só a criação do
   registro em `clientes`; nada impedia duas mensagens rápidas do gate (nome e
   e-mail em sequência) serem processadas fora de ordem. Corrigido: lock consultivo
   por telefone durante os passos do gate.

## Simulação de cenários (rodada 2 — achados críticos)

Cinco situações simuladas com foco em quebrar o desenho, não em confirmá-lo:

1. **Gate sem saída (o mais grave — não é só técnico)** — alguém que se recusa a dar
   nome/e-mail fica preso para sempre, sem nunca receber resposta. Isso é mais que UX
   ruim: exigir dado pessoal como pré-condição pra uma interação que não depende dele
   esbarra no princípio de necessidade da LGPD. **Não corrigido sozinho — vira decisão
   pendente abaixo**, porque contraria o requisito original explicitamente pedido.
2. **Corrida entre mensagens quase simultâneas cria dois cadastros** — sem
   constraint, duas execuções paralelas do `flow-engine` não se veem e podem criar
   duas linhas em `clientes` pro mesmo telefone (mesma classe de bug já ocorrida no
   módulo de campanhas). Corrigido: `telefone` único por tenant, upsert com conflict.
3. **"A campanha do número" não existe como conceito único** — um número pode ter
   rodado várias campanhas ao longo do tempo; a checagem em `campaign_recipients`
   nunca dizia contra qual campanha. Corrigido: checa qualquer campanha cujo
   `credential_id` bata com o número, não uma campanha singular.
4. **Nada impedia dois Flows ativos do mesmo tipo no mesmo número** — "o Flow ativo"
   pressupunha unicidade que o schema não garantia. Corrigido: índice único
   `(cloud_credential_id, tipo) WHERE ativo = true`.
5. **Gate não tratava mensagem não-texto nem clique de botão de template** — áudio,
   figurinha ou imagem durante o gate não tinham tratamento; clique de botão (já
   rastreado pelo módulo de campanhas) podia ser mal-interpretado como texto livre
   pra keyword, gerando resposta duplicada. Corrigido: reprompt genérico pra não-texto,
   e clique de botão nunca entra na comparação de keyword.

## Rodada 1 (referência)

Seis situações da primeira simulação, já corrigidas: boas-vindas engolindo a
pergunta (campanha, orgânico, e retorno após 14 dias), keyword sem forma de abrir
outro Flow, confirmação de que o cadastro tenant-wide funciona entre artistas
diferentes, e falta de checagem explícita de idempotência no fluxo.

## Interface self-service (`/dashboard/admin/flows`)

- Lista de Flows por número
- Criar/editar Flow: texto de boas-vindas, tabela de keywords (adicionar/editar/remover
  sem tocar em código), texto de fallback, toggle ativo/inativo
- **Permissão: admin e operator podem criar/editar Flow** (decisão fechada) — exclusão
  fica admin-only por simetria com o precedente já existente de sessões (regra 21:
  operator cria/conecta, só admin exclui); assumido por consistência, ajustar se quiser
  outra regra especificamente pra Flow
- Atalho para ver o que caiu em fallback recentemente (filtro sobre a caixa de entrada
  já existente) — é o sinal de que falta uma keyword
- Cadastro de número Cloud API novo: entra como entrega real desta fase, não como
  pergunta em aberto — reaproveitar `/dashboard/admin/campaigns/credentials` se já
  cobrir o fluxo; se cobrir só parcialmente, completar o que faltar (nome amigável do
  número, associação a artista/campanha) pra ficar de fato self-service

## Processo de conteúdo (boas-vindas e fallback)

Texto de boas-vindas e fallback não é campo de formulário preenchido por quem sobe o
Flow tecnicamente — é entregável de copy, seguindo o mesmo processo/skill já validado
pra régua de campanha (voz do artista, ex: Prof. Marli). A interface guarda o texto
final; quem escreve é o mesmo fluxo de hoje, não um campo genérico de banco.

**O texto de abertura do gate de cadastro (pedido de nome/e-mail) entra nesse mesmo
processo de copywriting, não fica como frase solta escrita por quem configura a
automação** — precisa incluir, de forma breve e na voz do canal, por que o dado é
pedido (LGPD). Vira item explícito do Sprint A2, junto do resto do conteúdo, em vez
de ficar só mencionado como risco sem dono.

Revisão do que caiu em fallback entra na pauta da reunião semanal de acompanhamento já
existente (a mesma que já cruza o board de mídia) — não cria ritual novo, e é o que
mantém a lista de keywords atualizada com o tempo.

## Checklist de onboarding de novo artista

Teste de prontidão do plano: novo artista = novo número + Flow personalizado + nova
agenda. O que é self-service hoje e o que ainda depende de aprovação da Meta:

- **Número novo** — self-service (cadastro de credencial Cloud API, Sprint A2)
- **Flow de palavra-chave personalizado** — self-service total (novo Flow, texto e
  keywords próprios do artista, via processo de copywriting) — sem envolvimento da Meta
- **Agenda do artista novo** — dado é self-service (cadastrar shows no formulário
  manual V1, já filtrado por `artista`). A estrutura do Flow (`agenda_shows`) é
  publicada uma única vez na WABA compartilhada (decisão fechada: os artistas dividem
  a mesma WABA) — um artista novo reaproveita o Flow já aprovado direto, sem nova
  espera pela Meta a cada artista
- **Estrutura de Flow genuinamente nova** (telas diferentes de `agenda_shows`) — não é
  self-service; é trabalho de dev + nova aprovação da Meta a cada vez, como já
  registrado em "Fora de escopo"

## Fases de entrega

0. **Spike isolado de criptografia do Flow** — prova de conceito da troca de chaves e
   decriptação/resposta, testada no Playground da Meta, antes de comprometer prazo do
   resto (ponto do dev sênior: isso não é "mais uma rota", é capacidade nova)
1. ADR de posicionamento (CLAUDE.md)
2. Migration (schema acima, incluindo `agenda_shows_sync` e a chave do Flow no
   `internal_secrets`)
3. Função `flow-engine` (motor de decisão do tipo `keyword_automation`, separada da
   função de captura) + função de envio
4. Endpoint dinâmico do Flow `agenda_shows` (usando o resultado do spike da fase 0),
   lendo `agenda_shows_sync`
5. Interface de gestão de Flows — formulário manual de agenda (V1), CRUD de
   keywords/boas-vindas/fallback, e cadastro self-service de número Cloud API
6. Conteúdo: textos de boas-vindas/fallback escritos via processo de copywriting já
   validado, não preenchidos ad-hoc
7. Piloto controlado (um número, uma campanha)
8. Ajuste contínuo — revisão de fallback entra na reunião semanal já existente
9. **V2, quando o painel-shows tiver API pronta:** ADR de integração painel-shows ↔
   wa-intelligence + job de sincronização, substituindo o formulário manual

## Divisão em sprints

Trilha A e Trilha B não têm dependência entre si e podem rodar em paralelo se houver
capacidade; com uma pessoa só, Trilha A primeiro (menor risco, entrega valor mais
rápido). Cada sprint aqui é uma unidade de trabalho, não necessariamente uma semana
fixa — ajustar conforme a capacidade real do time.

**Trilha A — automação por palavra-chave**
- Sprint A1: ADR de posicionamento, migration completa, função `flow-engine`, função de envio
- Sprint A2: CRUD de keywords/boas-vindas/fallback, cadastro self-service de número,
  conteúdo via processo de copywriting, piloto controlado só desse tipo

**Trilha B — agenda de shows**
- Sprint B1: spike isolado de criptografia do Flow, validado no Playground da Meta —
  nada da Trilha B avança sem isso resolvido
- Sprint B2: endpoint dinâmico do Flow `agenda_shows` (usando o resultado do spike),
  formulário manual de agenda (V1) na interface, e a capacidade de enviar mensagem
  interativa com token de Flow (necessária tanto pro botão que abre a agenda quanto
  pro `tipo_resposta='abrir_flow'` da Trilha A — `abrir_flow` fica bloqueado até essa
  capacidade existir)

**Sprint de convergência**
- Piloto controlado incluindo o Flow de agenda, com as duas trilhas já validadas
  isoladamente
- Início do ritual de revisão de fallback na reunião semanal já existente

## Modelo de IA recomendado pra execução (Claude Code)

Nota: informação de modelo muda com frequência — confirmar antes de iniciar se já
fizer tempo desde essa recomendação.

Não é um modelo único pro projeto inteiro — divide por tipo de trabalho:

- **Opus 5** — spike de criptografia (Sprint B1), migration + RLS multi-tenant (a
  regra de isolamento de tenant do `flow-engine` encontrada na rodada 6 é exatamente
  o tipo de raciocínio que pede o modelo mais cuidadoso), e a lógica central do
  `flow-engine` (máquina de estado do gate, idempotência, as correções acumuladas nas
  seis rodadas de simulação)
- **Sonnet 5** — telas de CRUD (gestão de Flows, keywords, agenda manual), cadastro
  self-service de número Cloud API, e qualquer sub-agente que o Claude Code disparar
  pra execução focada (buscar arquivo, rodar teste, formatar)

Modo sugerido ao abrir a sessão com este PRD: `opusplan` (Opus pro planejamento,
Sonnet pra execução) — ou Opus geral se estiver numa assinatura em vez de pay-per-token
da API, dado que o PRD já chega denso o suficiente pra não precisar economizar nessa
fase.

## Critérios de teste e validação

**Trilha A (`flow-engine`):**
- Casos determinísticos: primeiro contato → boas-vindas; keyword bate (incluindo
  variação de acento/maiúscula/plural); nenhuma keyword bate → fallback
- Reset de 14 dias: contato com `atualizado_em` de 15+ dias atrás recebe boas-vindas
  de novo; contato com menos de 14 dias não recebe
- Boas-vindas nunca engole a pergunta: contato novo (ou resetado) que já manda uma
  pergunta que bate keyword recebe boas-vindas E a resposta, não só boas-vindas
- `mensagem_pendente`: pergunta feita durante o gate de cadastro é respondida
  corretamente assim que nome e e-mail são completados, sem se perder
- Keyword com `tipo_resposta='abrir_flow'` dispara o envio do Flow referenciado em
  `flow_destino_id` corretamente
- Corrida: duas mensagens quase simultâneas do mesmo telefone não criam dois
  registros em `clientes` (constraint de unicidade + upsert com conflict)
- Lookup de campanha: telefone encontrado em `campaign_recipients` de uma campanha
  antiga do mesmo número ainda é reconhecido como `origem='campanha'`
- Dois Flows do mesmo tipo ativos no mesmo número: banco rejeita a criação/ativação
  do segundo (constraint, não validação de aplicação)
- Mensagem não-texto durante o gate (áudio, figurinha, imagem) recebe reprompt, não
  trava nem é aceita como resposta válida
- Degrade do gate: 2 respostas inválidas/ignoradas no mesmo campo avançam com esse
  campo nulo e `pulou_cadastro=true`, sem travar a conversa pra sempre
- Clique de botão de template nunca é comparado contra `flow_palavras_chave`
- RLS de `clientes`: operator sem visão geral não consegue listar clientes de outro
  artista; só enxerga dado de cliente dentro de uma conversa que já tem acesso
- Lock do gate: "João" e "joao@x.com" mandados em sequência rápida são processados
  em ordem, nunca a resposta de e-mail avaliada contra o campo nome
- `abrir_flow` só é testável depois da Trilha B entregar a capacidade de mensagem
  interativa com token de Flow — não faz parte dos testes da Trilha A isolada
- Validação de nome: string vazia, só número, só símbolo são rejeitados e reperguntados
- `fallbacks_consecutivos`: zera em keyword batida ou boas-vindas; atinge 3 → dispara alerta
- Retry de `pulou_cadastro`: contato marcado como pulado, ao disparar boas-vindas de
  novo (reset de 14 dias), tem o campo faltante repreguntado, não ignorado pra sempre
- Log de invocação: `flow-engine` grava `events_log` antes de processar, não depois
- Opt-out: telefone em `whatsapp_opt_outs` não recebe nenhum envio automático, nem o
  gate de cadastro
- Validação de nome rejeita frases (com "?" ou 6+ palavras); mensagem extra durante o
  gate que não valida é concatenada em `mensagem_pendente`, não descartada
- Sem Flow ativo pro número: `flow-engine` encerra sem enviar nada e loga o caso
- Isolamento de tenant: query simulada sem `.eq('tenant_id', ...)` num teste de
  integração cruzando dois tenants de teste deve ser pega antes de ir pra produção
- `gate_iniciado_por_flow_id` é gravado corretamente ao criar um cliente orgânico
- Pausa após alerta: ao atingir 3 fallbacks, `pausado_aguardando_humano=true` e a
  próxima mensagem não recebe fallback automático; uma keyword batendo depois destrava
- Erro de teto de tier (130472/131048/131056) no envio do `flow-engine` é logado, não
  tentado de novo às cegas
- Gate de cadastro: contato organico não avança pra nenhuma outra lógica até
  `cadastro_completo=true`; contato de campanha nunca passa pelo gate; e-mail inválido
  é reperguntado, não aceito; resposta fora de ordem (ex: manda e-mail quando o
  sistema esperava nome) é tratada sem travar a conversa
- Idempotência: mesmo `message_id` enviado duas vezes → só uma resposta sai (checagem
  explícita no passo 0 do fluxo técnico, não só um critério solto)
- Janela de 24h: contato com última mensagem há mais de 24h → não tenta mensagem
  livre, loga o motivo em vez de falhar silenciosamente
- Falha de insert: forçar erro proposital (coluna errada) e confirmar que aparece
  logado — não passa sem esse teste, dado o histórico de bug silencioso no projeto

**Trilha B (endpoint criptografado):**
- Validação completa no Playground oficial da Meta — critério de saída do spike (B1),
  não do projeto inteiro
- Resposta correta ao health-check periódico da Meta
- Latência sob carga simulada, com folga dentro do teto de 10s exigido pela Meta
- Payload malformado / notificação de erro tratados sem travar o endpoint

**Nas duas trilhas:**
- RLS: operator sem acesso a um número não vê nem edita Flows de outro número —
  teste dedicado (mesma classe de bug já ocorrida em `messages`, regra 20)

**Conteúdo:**
- Boas-vindas e fallback aprovados por quem já valida a voz da campanha — critério é
  "soa como o personagem", não "o campo foi preenchido"

**Critério de saída do piloto:**
- Duração definida antes de começar (ex: até o fim da campanha escolhida)
- Métricas mínimas: % resolvido por keyword vs. caído em fallback, zero duplicidade
  de resposta, zero vazamento entre tenants, latência do endpoint dentro do esperado
- Critério de abortar: qualquer vazamento de RLS entre tenants para tudo na hora;
  fallback acima de um limite (a definir com dado real do piloto) sinaliza curadoria
  de keyword imatura antes de expandir pra mais números

## Riscos e pontos de atenção

- **Latência do endpoint da agenda** — o teto de 60s do Supabase (regra 17) não é o
  limite relevante aqui; o WhatsApp exige resposta rápida do endpoint do Flow. Manter
  o handler enxuto, sem chamada externa dentro dele.
- **Criptografia do endpoint** — superfície nova (chave pública/privada, payload
  criptografado, resposta ao health-check periódico da Meta). Endereçado via spike
  isolado antes do resto (fase 0); testar no Playground oficial antes de produção e
  tratar o health-check explicitamente.
- **Reentrega duplicada de webhook** — idempotência via `message_id` do WhatsApp como
  chave natural (mesmo padrão do `campaign-sender`), pra não duplicar boas-vindas/resposta.
- **Janela de 24h pra mensagem livre** — checar antes de enviar; fora da janela, a
  Cloud API rejeita mensagem livre (cai pra template ou não responde, logando o motivo).
- **RLS nas tabelas novas** — aplicar o padrão de `has_session_access()` já existente;
  revisar que a policy nova substitui, não soma (armadilha já ocorrida em `messages`, regra 20).
- **Falha silenciosa de insert** — bug mais repetido no projeto (regras 10, 12, 13).
  Checklist de review obrigatório pra insert nas tabelas novas.
- **Defasagem da agenda manual (V1)** — mostrar "atualizado há X dias" na tela de gestão.
- **Aprovação da Meta pro Flow** — confirmar cedo se esse Flow exige revisão antes de
  ir ao ar, pra não atrasar o piloto.
- **Loop de fallback sem saída** — após `fallbacks_consecutivos` atingir 3 (campo em
  `flow_contato_estado`, ajustável), disparar alerta (reaproveitando o sistema de
  alertas por keyword já existente) pra um humano olhar.
- **Escopo crescendo sem decisão explícita** — todo ajuste de escopo atualiza a nota de
  posicionamento no CLAUDE.md antes do PR, não depois.
- **Máquina de estado do cadastro** — é o pedaço mais novo do motor de decisão: lead
  pode ignorar a pergunta e mandar outra coisa, responder as duas perguntas fora de
  ordem, ou mandar um e-mail com erro de digitação. O gate precisa reperguntar de
  forma clara em vez de travar ou aceitar dado inválido.
- **LGPD** — coletar nome e e-mail é dado pessoal; o wa-intelligence já lista
  compliance/LGPD como próximo item do roadmap de inteligência. Vale pelo menos uma
  linha explicando por que os dados são pedidos, já na primeira mensagem do gate.
- **Gate de cadastro sem resposta** — resolvido via degrade após 2 tentativas por
  campo (ver "Decisões fechadas"); risco residual é só de implementação: garantir que
  o contador reseta certo ao trocar de campo e que `pulou_cadastro=true` fica visível
  pra quem for analisar os dados depois.
- **Corrida na criação de clientes** — mesma classe de bug já ocorrida no módulo de
  campanhas (upsert em lote com chave duplicada); mitigado por constraint de
  unicidade, mas vale teste de carga simulando mensagens simultâneas de verdade.
- **Corrida dentro do gate** — distinta da corrida de criação: mensagens rápidas em
  sequência durante a coleta (nome, depois e-mail) podem ser processadas fora de
  ordem sem um lock por telefone durante os passos do gate.
- **Acesso a `clientes`** — tabela tenant-wide de PII (nome, e-mail) sem o controle
  de acesso por sessão que o resto do projeto usa (regra 20). Proposta padrão:
  listagem geral admin-only, operator só vê via conversa já autorizada — a confirmar.
- **`abrir_flow` depende de capacidade que não existe** — mandar um Flow nativo
  dentro da conversa exige mensagem interativa com token de Flow; `graphClient.ts`
  nunca precisou gerar esse formato. Não é reaproveitamento, é trabalho novo da
  Trilha B — `abrir_flow` fica bloqueado até lá.
- **`tenant_id` faltando** — `flow_contato_estado` e `flow_palavras_chave` violavam a
  regra 1 do CLAUDE.md ("em toda tabela, sem exceção"); corrigido no schema, mas vale
  checklist de review pra não deixar passar de novo em tabela futura.
- **Invocação do `flow-engine` sem log** — se a chamada a partir do webhook falhar
  antes de rodar qualquer lógica, não havia rastro. Corrigido: log em `events_log`
  antes de invocar.
- **Gate duplo entre canais** — risco aceito conscientemente (ver Modelo de dados),
  não corrigido — raro demais pra justificar coordenação entre canais.
- **Qualidade do dado em `clientes`** — sem validação de nome, a base que é o próprio
  objetivo do projeto ficaria contaminada. Corrigido: validação mínima de nome.
- **Direito ao esquecimento (LGPD)** — soft-delete não apaga PII de verdade. Corrigido
  como requisito: ação de exclusão real, separada do padrão do resto do projeto.
- **Opt-out desconectado** — `whatsapp_opt_outs` já existia no módulo de campanhas mas
  nunca era checado pelo `flow-engine`. Corrigido: checagem antes de qualquer envio
  automático.
- **Isolamento de tenant no `flow-engine`** — função roda com service role pra todos
  os tenants; sem `.eq('tenant_id', ...)` explícito em toda query, é vazamento de
  dado entre negócios inteiros, não só entre artistas. Risco de maior severidade
  desta PRD até agora — corrigido como regra explícita, mas merece atenção extra em
  code review, dado o custo de um erro aqui.
- **Fallback sem pausa** — alertar um humano e continuar respondendo automaticamente
  a mesma coisa não ajuda ninguém. Corrigido: `pausado_aguardando_humano`.
- **Teto de tier de mensageria não herdado** — `campaign-sender` já sabe tratar os
  códigos de erro de limite de mensagens/24h; `flow-engine` não tratava. Corrigido:
  mesmo tratamento, log em vez de retry cego.

## Decisões fechadas nesta rodada

- Permissão de Flow: admin e operator podem criar/editar (exclusão fica admin-only por
  simetria com sessões)
- Artistas da Plauz compartilham uma única WABA — Flow de agenda reaproveitado
  instantaneamente entre artistas, sem nova espera pela Meta a cada um
- `recebeu_boas_vindas` reseta após 14 dias de inatividade, não é permanente
- Gate de cadastro degrada após 2 tentativas por campo (nome e e-mail, cada um), em
  vez de bloquear pra sempre — resolve o risco de LGPD/UX levantado na simulação sem
  abandonar a intenção original de tentar coletar o dado

## Execução (Claude Code) — migration 0025_flows_automacao.sql

Nota de posicionamento no CLAUDE.md já aprovada. Migration em revisão: o Claude Code
inspecionou o repo real (não assumiu as convenções do PRD) e corrigiu três pontos —
sem view `_ativos` (não existe no projeto), `tipo` como `text + check` (sem
`create type` em lugar nenhum do schema), e os detalhes já incorporados acima
(`has_cloud_credential_access()`, a unique de keyword duplicada, o `deleted_at is null`
no índice de Flow ativo). Timestamps padronizados pra inglês (decisão fechada acima),
`clientes` admin-only confirmado, `flow_destino_id` validado por trigger.

**Status:** migration 0025 aplicada em produção (`supabase db push`, projeto
`byuggqcnvezendgrcysb`) — RLS ligada e policies/triggers conferidos nas cinco tabelas.
Teste dedicado de `has_cloud_credential_access` escrito
(`supabase/tests/0025_flows_automacao_rls.sql`), primeiro arquivo de teste do
projeto — ainda não executado (aguardando rodar contra Supabase local, nunca
produção) nem commitado junto com a migration e a nota do CLAUDE.md.
