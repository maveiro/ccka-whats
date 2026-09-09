# PRD: Central de Shows — wa-intelligence

## Contexto

A Trilha B entregou um Flow de agenda que funciona ponta a ponta (validado em
aparelho real em 09/09/2026): a Meta cifra, nosso endpoint abre, consulta
`agenda_shows_sync` e devolve as telas. Hoje esse Flow é de uso único — abre,
mostra a agenda, fecha.

A Central de Shows transforma isso num **espaço permanente por artista**: o fã
entra, vê a agenda, consulta o FAQ e — se ainda não for conhecido — se cadastra
ali mesmo. É o mesmo canal que recebe tráfego de anúncio click-to-WhatsApp e de
campanhas manuais.

**Uma central por artista** (decisão do fundador). Isso preserva a premissa
atual: cada número Cloud API tem seu `artista`, e agenda e FAQ são filtrados por
ele. Não há tela de escolha de artista dentro do Flow.

## Objetivo

Um Flow por artista, com duas portas de entrada:

- **Quem já tem cadastro** (veio da landing ou de campanha anterior) → cai
  direto no **menu**: Agenda e FAQ.
- **Quem chega sem cadastro** → vê uma **apresentação curta da central** e um
  **formulário de cadastro** com o texto legal de LGPD, e só então o menu.

E um caminho de entrada de dados fora do WhatsApp: o **formulário da landing
page** grava direto na nossa base, para que a pessoa já chegue reconhecida.

## Fora de escopo (nesta fase)

- **Notificação automática de show próximo.** Decisão do fundador (09/09/2026):
  avisar sobre shows é **campanha de marketing manual e pontual**, pelo módulo
  de campanhas que já existe. Isso remove do escopo a tabela de preferências de
  notificação, a coleta de cidade, o job de agendamento, a idempotência de aviso
  e a segmentação automática — que seriam a parte mais complexa e a que exigiria
  consentimento granular por cidade/artista.
- IA gerando resposta livre — mantém a decisão original do projeto.
- Inbox de atendimento com status/atribuição — idem.
- Cadastro com campos além de nome, e-mail e telefone (cidade, data de
  nascimento, preferências). O modelo suporta, mas coletar dado que ninguém vai
  usar é passivo de LGPD, não ativo de produto.

## Posicionamento: por que NÃO precisa de nova nota no CLAUDE.md

O CLAUDE.md tem duas notas de reabertura consciente de escopo: campanhas
(06/08/2026) e automação por Flow (04/09/2026). A Central de Shows fica dentro
da segunda — resposta por **regra fixa**, sem IA, sem inbox de atendimento — e o
disparo manual já está coberto pela primeira.

O que **teria** exigido nota nova era a notificação proativa segmentada, e ela
saiu do escopo. Se voltar, a nota volta com ela.

## Modelo de dados

Segue as convenções fixadas: `tenant_id` em toda tabela, RLS habilitada,
`created_at`/`updated_at` em inglês, vocabulário de domínio em português,
`text` + `check` em vez de enum nativo.

### Alterações em `clientes`

```
+ consentimento_em      timestamptz   -- quando aceitou
+ consentimento_versao  text          -- QUAL texto aceitou (ex: "v1-2026-09")
+ consentimento_origem  text          -- landing | flow | campanha
+ origem                             -- passa a aceitar 'landing' e 'flow'
```

Registrar a **versão do texto** não é burocracia: sem ela, quando o texto legal
mudar, não há como saber a que cada pessoa consentiu — e o texto na tela vira
enfeite. É o complemento natural da exclusão real de PII (migration 0029), que
já existe.

### `faq_itens`

```
id, tenant_id, artista, pergunta, resposta, ordem, ativo,
created_at, updated_at, deleted_at
```

FAQ é **dado, não texto no Flow JSON**. Flow publicado é imutável: se as
perguntas viverem no JSON, corrigir uma vírgula exige republicar na Meta. Vindo
do banco, a edição é na nossa tela e reflete na hora.

**Ganho colateral:** a mesma tabela alimenta as respostas de palavra-chave da
Trilha A, que hoje têm o texto digitado à parte em `flow_palavras_chave`. Uma
fonte, dois canais — e o que for corrigido no FAQ corrige a automação junto.

### `flow_sessoes`

```
id, tenant_id, token (unique), telefone, flow_id,
cloud_credential_id, created_at, expira_em
```

**É o que resolve o problema central de identidade.** A requisição que a Meta
manda ao endpoint **não traz o telefone do usuário** — traz a ação, a tela e o
`flow_token`, campo opaco definido por nós no envio. Sem uma associação
guardada, "quem já tem cadastro vê o menu" é impossível de implementar.

Token **aleatório**, com o telefone só do nosso lado. A alternativa — embutir o
telefone no token — faria PII trafegar pelo aparelho num campo que não
controlamos.

`expira_em` (proposta: 30 dias) evita que um token vazado sirva para sempre.

### `landing_api_keys`

```
id, tenant_id, nome, key_hash, ativo, created_at, last_used_at
```

Credencial que a landing usa para gravar. **Guardar hash, não a chave** — é a
primeira credencial do projeto que fica com terceiros (o site), e diferente do
`access_token` da Meta, esta nós geramos e podemos hashear sem perder função.

### `whatsapp_flows.tipo`

Passa a aceitar `'central'`, além de `keyword_automation` e `agenda_shows`. O
índice único `(cloud_credential_id, tipo) WHERE ativo` continua valendo: uma
central ativa por número.

## Fluxo técnico

### Abertura da central (endpoint)

1. `phone_number_id` da URI → credencial → `tenant_id` e `artista`
   (regra de isolamento da Trilha A: nunca confiar em campo do corpo)
2. `flow_token` → `flow_sessoes` → telefone
   - **token não encontrado ou expirado** → trata como não identificado, segue
     para apresentação + cadastro (o formulário pede o telefone)
3. Telefone → `clientes` (com `tenant_id` explícito)
   - **cadastro completo** → tela `MENU`
   - **sem cadastro, ou incompleto** → `APRESENTACAO` → `CADASTRO`
4. `MENU` → `AGENDA` (já existe) ou `FAQ_LISTA` → `FAQ_RESPOSTA`

### Cadastro dentro do Flow

- Formulário: nome, e-mail e aceite do texto legal (obrigatório).
- Ao concluir: upsert em `clientes` com `origem='flow'`,
  `consentimento_em/versao/origem` preenchidos, e o telefone da sessão.
- **Não sobrescrever dado bom:** se a pessoa já existir com nome preenchido, um
  envio com campo vazio não pode apagar o que havia.

### Cadastro pela landing

`POST /api/public/cadastro`, autenticado por `landing_api_keys`:

1. Valida a chave → resolve o tenant (a landing nunca escolhe o tenant)
2. **Normaliza o telefone para E.164.** É o ponto que mais quebra na prática e
   quebra em silêncio: se a landing manda `(41) 99999-9999` e o WhatsApp
   identifica `5541999999999`, viram duas pessoas — e a central nunca reconhece
   quem se cadastrou, que é exatamente o caso de uso.
3. Upsert por `(tenant_id, telefone)`, preenchendo lacunas
4. Grava consentimento com a versão do texto vinda do formulário
5. Responde **sempre igual**, exista ou não o cadastro — resposta diferente
   permitiria testar se um telefone está na base
6. Registra em `events_log`

Proteções mínimas: limite por IP, honeypot no formulário, tamanho máximo de
payload.

### Entrada por campanha (o caminho principal)

Como a notificação virou campanha manual, **a campanha é a porta de entrada
principal da central** — e isso expõe uma lacuna: `campaign-sender.buildComponents()`
só monta o **corpo** do template com variáveis posicionais. Um template com
**botão de Flow** exige um componente `button` com `sub_type: "flow"`,
`flow_token` e `flow_action_data`. Hoje o sender não sabe fazer isso.

Precisa: gerar uma `flow_sessoes` por destinatário no momento do envio e
preencher o botão. É trabalho novo, não configuração.

### Entrada por click-to-WhatsApp

O anúncio leva a pessoa a mandar mensagem; o webhook captura normalmente. A
mensagem traz um bloco `referral` (anúncio de origem, título, corpo) que hoje
fica preservado em `raw_payload` mas **não é extraído**. Guardar a origem no
cliente permitiria saber por qual anúncio cada cadastro entrou — atribuição
real, não estimativa. Não é obrigatório para a central; é barato se feito junto.

## Decisão pendente: o gate conversacional vira legado?

Hoje quem escreve pela primeira vez cai no **gate do `flow-engine`**: a
automação pergunta nome, depois e-mail, por mensagem de texto, com degrade após
2 tentativas e validação por palavras-gatilho.

Com o cadastro dentro do Flow, passam a existir **dois caminhos de cadastro para
a mesma pessoa**, com regras diferentes. Três saídas:

1. **Desligar o gate onde houver central ativa** — quem escreve sem cadastro
   recebe uma mensagem curta com o botão da central. Um formulário é melhor que
   perguntar por chat, e elimina a duplicidade. **Recomendada.**
2. Manter os dois — duplica regra e cria divergência de dado.
3. Gate como fallback, se a pessoa ignorar o Flow e continuar escrevendo.

A recomendação é a 1, marcando o gate como caminho legado no motor (sem apagar:
números sem central continuam usando).

## Riscos e pontos de atenção

- **Identidade via `flow_token`** — se a sessão não for criada no envio, o
  endpoint não sabe quem é a pessoa e todo mundo cai no cadastro. É o ponto de
  falha mais provável do desenho.
- **Normalização de telefone** — landing e WhatsApp precisam convergir para a
  mesma chave; divergência aqui é silenciosa e só aparece como "a central não me
  reconhece".
- **Primeiro endpoint público de escrita do projeto** — tudo hoje é autenticado,
  assinado ou interno. Abuso, enumeração e lixo na base passam a ser possíveis.
- **Flow publicado é imutável** — cada ajuste de tela é versão nova. Quanto mais
  conteúdo vier do banco (agenda, FAQ, textos), menos republicação.
- **Latência do endpoint** — hoje mediana ~900ms com uma consulta. O menu
  acrescenta a resolução de sessão e cliente; medir de novo, e considerar cache
  de credencial por worker se passar de ~1,5s.
- **Payload do Flow tem limite de tamanho** — FAQ longo precisa de teto de itens
  e, se crescer, paginação.
- **Consentimento sem versão** — texto legal muda e ninguém sabe quem aceitou o
  quê. Mitigado por `consentimento_versao`, que precisa ser preenchido nas três
  origens.
- **Dado de cadastro sobrescrito** — upsert descuidado apaga nome/e-mail bons
  com campo vazio.

## Sprints

**C1 — Fundação da central**
- Migrations: `faq_itens`, `flow_sessoes`, consentimento em `clientes`, `tipo='central'`
- `flow_sessoes` criada no envio (`flow-engine` e script de teste)
- Endpoint: identidade por token, `MENU`, `FAQ_LISTA`, `FAQ_RESPOSTA`
- Tela de FAQ no painel
- Flow `central` publicado por artista

**C2 — Cadastro pela landing**
- `landing_api_keys` + geração de chave no painel
- `POST /api/public/cadastro` com normalização, upsert sem sobrescrever,
  consentimento e proteções
- Snippet pronto para colar na landing

**C3 — Cadastro dentro do Flow**
- Telas `APRESENTACAO` e `CADASTRO` com texto legal
- Gravação em `clientes` a partir do endpoint
- Decisão sobre o gate conversacional aplicada

**C4 — Campanha que abre a central**
- `campaign-sender` preenchendo botão de Flow com `flow_token`
- UI de campanhas escolhendo qual Flow abrir
- Template com botão de Flow aprovado na Meta

**C5 — Piloto**
- Um artista, um número, uma campanha
- Revisão de FAQ e fallback no ritual semanal já existente

## Critérios de teste

- Token válido de pessoa cadastrada → `MENU`; token válido de pessoa sem
  cadastro → `APRESENTACAO`
- Token inexistente ou expirado → cadastro, nunca erro
- Cadastro no Flow grava consentimento com versão e não sobrescreve nome
  existente com vazio
- Landing: `(41) 99999-9999`, `+55 41 99999-9999` e `5541999999999` resolvem
  para o mesmo cliente
- Landing sem chave, com chave inválida ou de outro tenant → recusado, e a
  resposta não revela se o telefone existia
- FAQ: item inativo não aparece; ordem respeitada; teto de itens aplicado
- Agenda e FAQ filtrados pelo artista **daquele número**
- Isolamento de tenant em toda query do endpoint (`.eq('tenant_id', ...)`)
- Exclusão de PII: cliente com `pii_apagada_em` não volta a ser perguntado
- Campanha com botão de Flow: cada destinatário recebe token próprio, e abrir o
  Flow identifica a pessoa certa
- Latência do endpoint dentro do orçamento com menu + FAQ + agenda

## Decisões fechadas

- **Uma central por artista** (não uma da Plauz inteira)
- **Notificação de show é campanha manual**, não automação agendada
- **Cadastro em duas portas**: landing (form → nosso banco) e Flow (para quem
  chega sem cadastro)
- **Sem nota nova de posicionamento** — o escopo cabe nas duas já existentes
