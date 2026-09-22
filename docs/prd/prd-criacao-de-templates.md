# PRD: Criação de templates pela plataforma — wa-intelligence

**Data:** 22/09/2026
**Status:** Fases 1, 2, 3 e parte da 4 implementadas (22/09/2026). Só
categoria Authentication segue de fora, por decisão (zero uso hoje).

## Contexto

Hoje o módulo de campanhas **lê** templates da Graph API (`listMessageTemplates`,
filtrado a `APPROVED`) mas não **cria** nenhum — todo template usado até aqui
foi montado à mão no WhatsApp Manager, fora da plataforma. Isso custou dois
incidentes reais já documentados no CLAUDE.md: um template com variável no
cabeçalho que o disparador não sabia montar (18/09/2026), e a dependência do
domínio próprio para o botão de URL rastreada (`/c/{{1}}`) — que só agora,
com `link.plauz.com.br` no ar, tem para onde apontar.

Uma interface de criação fecha os dois: o formulário só deixa existir um
template que o `campaign-sender` sabe disparar, e o botão de URL rastreada
sai pré-preenchido com a convenção certa — ninguém digita `/c/{{1}}` de
memória de novo.

## Decisões já tomadas (confirmadas com o fundador, 22/09/2026)

1. **Escopo v1: categorias Marketing e Utility.** Authentication (OTP) fica
   de fora — formato rígido próprio, sem nenhum fluxo de autenticação por
   WhatsApp na plataforma hoje.
2. **Status sob demanda, não webhook.** Botão "Atualizar status" na lista +
   um `pg_cron` de conferência, reaproveitando `listMessageTemplates`. Sem
   mudança no Meta App, sem Edge Function de webhook nova — o ganho de
   latência de um webhook em tempo real não se justifica para uma aprovação
   que a Meta já demora horas para decidir.

## Objetivo

Um admin monta um template inteiro — nome, categoria, idioma, cabeçalho,
corpo com variáveis, rodapé, botões — sem sair do painel, submete para
revisão da Meta, e acompanha o status (pendente / aprovado / rejeitado, com
o motivo) na mesma tela que hoje só lista o que já existe.

## Fora de escopo (v1)

- **Cabeçalho de mídia** (imagem/vídeo/documento). Exige a Resumable Upload
  API da Meta para gerar o `header_handle` de exemplo — um subsistema à
  parte, sem uso hoje (nenhum template em produção tem cabeçalho de mídia;
  é inclusive a mesma lacuna que a regra 63 do CLAUDE.md documentou como
  "ainda não montamos esse parâmetro" no disparo). Entra como PRD próprio se
  algum artista pedir.
- **Categoria Authentication** — decisão mantida, zero uso hoje.
- **Webhook de status em tempo real** (decisão acima).
- **`parameter_format: named`.** A Meta aceita variável nomeada
  (`{{primeiro_nome}}`) desde uma versão recente da API; toda a plataforma —
  wizard, `campaign-sender`, `variaveis.ts` — assume posicional (`{{1}}`,
  `{{2}}`...). Misturar os dois formatos exigiria revisar três lugares para
  um ganho cosmético.

## Como a Meta funciona (o que a UI precisa respeitar)

- **`POST /{waba_id}/message_templates`** — `name`, `language`, `category`,
  `components`. Resposta: `{ id, status, category }`.
- **`name`**: até 512 caracteres, **só minúsculo, dígito e `_`**. A tela pede
  um título legível ("Vendas abertas — Natal") e deriva o `name` por
  slugify, do mesmo jeito que `paginas`/`formularios` já derivam `slug`.
- **Unicidade**: `name` + `language` é único por WABA. Duplicar sem mudar um
  dos dois volta erro da Graph API — repassado como está, sem reescrever a
  mensagem.
- **Limites de caractere** (doc da Meta): cabeçalho de texto até 60,
  corpo até 1024, rodapé até 60. Validado no formulário antes de submeter.
- **Variáveis**: cabeçalho de texto aceita **no máximo 1** placeholder; corpo
  aceita quantos precisar, numerados a partir de `{{1}}`. Cada um exige um
  valor de **exemplo** no `components` (`example.header_text` /
  `example.body_text`) — sem exemplo plausível, a Meta recusa a submissão.
  A contagem espelha a mesma lógica de `campaign-sender/variaveis.ts`
  (regra 63): cabeçalho e corpo numeram independentemente, e é o COMPONENTE
  que decide o destino, não o número.
- **Botão de URL rastreada, pré-preenchido.** Ao marcar "rastrear clique" (
  padrão ligado), a URL vai fixa em `https://link.plauz.com.br/c/{{1}}` e o
  exemplo em algo como `k7Qm2xR9tA` — a mesma convenção da regra 32. Desligar
  a opção libera URL estática ou outro padrão, para o caso raro de precisar.
- **Botão de Flow.** Reaproveita a MESMA validação que `POST /api/campaigns`
  já faz (regra 37): Flow escolhido precisa ser do mesmo número, tipo
  abrível, ativo e publicado — só que aqui a checagem acontece na hora de
  montar o template, não na hora de criar a campanha.
- **Categoria pode ser RECLASSIFICADA pela Meta**, na aprovação ou depois —
  template marcado como Utility mas com linguagem promocional sai como
  Marketing, e o preço segue a categoria final, não a pedida. A tela avisa
  isso no formulário (não dá para prevenir, só avisar) — e não é um problema
  novo para o resto do sistema: `POST /api/campaigns/templates` já lê a
  categoria **ao vivo** da Meta a cada carregamento do assistente de
  campanha, então uma reclassificação depois da aprovação nunca fica
  desatualizada no que a campanha cobra.
- **Combinação exata de botões** (quantos quick-reply cabem com quantos de
  URL/telefone) não é duplicada na validação do formulário — muda de tempos
  em tempos e divergir da Meta seria pior que não checar. A submissão
  devolve o erro da Graph API, com a frase, direto no painel de rejeição.

## Modelo de dados: nenhuma tabela nova

Decisão deliberada, não omissão. A Meta já é a fonte da verdade de todo
template (nome, categoria, status, motivo de rejeição, `quality_score`) e
`listMessageTemplates` já lê isso ao vivo. Guardar uma cópia local seria:

- **redundante** para status/categoria — desatualizaria sozinho a cada
  reclassificação, exatamente o problema que o ponto acima evita;
- **sem uso real** para rascunho — o fluxo é preencher e submeter na mesma
  sessão, como o resto do assistente de campanha já funciona hoje.

O que fica local é só o de sempre: `events_log` (`template_criado`,
sucesso ou rejeição) — é a auditoria, e é suficiente.

## Telas

- **`/dashboard/admin/templates`** (nova) — lista, com seletor de número
  (mesmo padrão do assistente de campanha, regra 58: template é da WABA, não
  do número, mas o seletor decide qual WABA). Cada linha mostra nome,
  categoria, idioma, status (`PENDING`/`APPROVED`/`REJECTED`, com o motivo
  quando rejeitado) e botão "Atualizar status".
- **"Novo template"** — formulário em etapas, no mesmo espírito do
  `CampaignWizard`:
  1. Número (WABA) → nome amigável → categoria → idioma (padrão `pt_BR`).
  2. Cabeçalho (nenhum / texto) → corpo com preview ao vivo dos `{{n}}` →
     rodapé.
  3. Botões: URL rastreada (padrão) / URL estática / Flow / resposta rápida
     / telefone — até o limite que a Meta aceitar.
  4. Revisão: preview da mensagem como o fã vê, valores de exemplo de cada
     variável, aviso de reclassificação de categoria → Enviar para revisão.

## Rotas

- `POST /api/templates` — monta o payload, valida limites de caractere e
  contagem de variável, chama `createMessageTemplate` (novo em
  `graphClient.ts`), grava `events_log`. Admin-only, mesmo padrão de
  `/api/campaigns`.
- `GET /api/templates` — como `GET /api/campaigns/templates` hoje, mas sem o
  filtro `status === "APPROVED"` e com `rejected_reason`/`quality_score`
  passados adiante.

## Riscos e armadilhas antecipadas

- **Limite de criação: 100 templates/hora por WABA** (doc da Meta) —
  irrelevante no volume atual, vale só um comentário no código para quem
  reencontrar um 429 estranho aqui.
- **Cabeçalho de texto com variável**: template criado pela plataforma
  nunca cai no bug da regra 63, porque o formulário monta cabeçalho e corpo
  como componentes distintos desde o início — não tem como nascer errado.
- **Botão de URL rastreada sem o domínio no ar**: já não é mais risco —
  `link.plauz.com.br` está em produção desde 21/09/2026.

## Terceiro achado real: edição só funciona em REJECTED (22/09/2026)

Testado ao vivo, direto: criar um template, tentar editar (`POST
/{template_id}` mudando só o corpo) enquanto ele ainda estava `PENDING`. A
Meta recusou: `error_subcode 2388003`, *"Os modelos de mensagem só podem ser
editados se tiverem sido rejeitados."* Ou seja, o endpoint de edição da Meta
**não é** uma via geral de atualizar template aprovado — é só para consertar
um rejeitado e reenviar, sob o MESMO nome. Isso muda o desenho original do
PRD (que previa "duplicar com `_v2`" para qualquer ajuste): agora um
REJECTED tem "Editar e reenviar" na tela, preenchido a partir do que já
existe (`formularioAPartirDeComponentes`, parser reverso e puro); `_v2` /
duplicar continua sendo o caminho para um template já APROVADO que precisa
mudar — esse continua impossível de editar, e sem uso reportado ainda.

**Limitação conhecida e não testada:** não há como forçar a Meta a rejeitar
um template de teste em minutos (a revisão leva horas), então o CAMINHO
FELIZ da edição (`components` novos aceitos, volta a `PENDING`?) não foi
confirmado ao vivo — só a regra de bloqueio foi. O erro da Meta, seja qual
for, é repassado como veio; o primeiro uso real vai confirmar o resto.

## Cabeçalho de mídia, validado ponta a ponta (22/09/2026)

A Resumable Upload API é um subsistema à parte da Graph API normal — três
passos (`POST /{app_id}/uploads` → sessão; `POST /{sessão}` com o binário e
`Authorization: OAuth` em vez de `Bearer` → handle `h`; `example.header_handle:
[h]` no componente HEADER da criação). Testado ao vivo com um PNG de 4×4
gerado na hora: sessão criada, upload aceito, handle usado para criar um
template de verdade com cabeçalho IMAGE (`status: PENDING`), removido em
seguida.

**`app_id` não vinha guardado em lugar nenhum** — `whatsapp_cloud_credentials`
salva `waba_id`/`phone_number_id`/`access_token`, nunca o app da Meta que
emitiu o token. Resolvido via `GET /debug_token?input_token=X&access_token=X`
(um token perguntando sobre si mesmo) em vez de um env var novo — e mais
correto, porque WABAs diferentes podem ter tokens emitidos por apps
diferentes (o CLAUDE.md já registra 3 apps inscritos na WABA da Plauz).

**O handle não é reaproveitável.** Ele é de uma sessão de upload específica,
de duração curta. Editar um template com cabeçalho de mídia (a combinação
com a Fase 4b, edição de REJECTED) exige subir o arquivo de novo — o
formulário mostra isso e bloqueia o envio até a mídia nova estar pronta.

## Segundo achado real, ao testar o botão de Flow (22/09/2026)

Um `flow_id` inválido do lado da Meta (não deveria acontecer — a rota
valida o Flow ANTES de montar o payload) não volta um erro claro tipo "Flow
não encontrado": volta `(#2) Service temporarily unavailable`,
`is_transient: true` — reproduzido duas vezes, mesmo erro as duas. Um texto
que sugere "tente de novo" e nada indica que o problema é o `flow_id`.
Documentado em comentário na rota, mas não tratado como caso especial: a
validação prévia (mesmo tenant, mesmo número, ativo, publicado — regra 37)
já cobre o caminho normal, e reescrever a mensagem de um erro que um usuário
de verdade nunca deveria ver custaria mais do que vale.

## Achado real, não documentado em lugar nenhum (22/09/2026)

Testando contra a Graph API de verdade (não só a doc): **o CORPO não pode
começar nem terminar em variável.** `"Seu show é dia {{1}}."` foi recusado
(`error_subcode 2388299`, *"As variáveis não podem estar no início ou no fim
do modelo"*); `"Seu show é dia {{1}} às 20h."` foi aceito — pontuação sozinha
depois da variável não conta como "ter conteúdo", só letra/dígito conta.

Confirmado que a regra **não vale para o cabeçalho** — `"Olá, {{1}}!"`
(variável no fim) e `"{{1}}, seu horário chegou"` (no início) foram aceitos
os dois. Nenhuma doc consultada (oficial ou de terceiros) menciona essa
assimetria entre cabeçalho e corpo.

Consequência: `montarComponentes()` recusa ANTES de chamar a Meta
(`variavelNaBordaDoCorpo`, com teste dedicado que espelha os quatro casos
reais testados), e o formulário avisa em tempo real enquanto a pessoa
digita — sem isso, o primeiro sinal seria um 400 críptico depois de preencher
o formulário inteiro.

## Plano de implementação (fases)

1. **Feito (22/09/2026).** `createMessageTemplate` em `graphClient.ts` +
   `GET /api/templates` (extensão da rota existente) + tela de lista —
   status, categoria, motivo de rejeição, nota de qualidade.
2. **Feito (22/09/2026).** Formulário completo (cabeçalho texto, corpo com
   preview ao vivo, rodapé, botão de URL rastreada). Validado ponta a ponta
   contra a Graph API real: um template com header+body+footer+botão
   rastreado, seguindo as regras acima, foi criado (`status: PENDING`) e
   removido em seguida (era só teste).
3. **Feito (22/09/2026).** Botão de Flow (`flow_action: "navigate"`, tela
   de entrada = `whatsapp_flows.tela_inicial` quando setada, senão o padrão
   do tipo — a mesma que o `flow-engine` resolveria) e resposta rápida.
   Validado ao vivo: botão de Flow (`Central de shows` do IB) e resposta
   rápida foram criados de verdade (`PENDING`) e removidos em seguida.
4. **Parcial (22/09/2026).** Cabeçalho de mídia (upload real testado) e
   edição de REJECTED (testado o bloqueio, não o caminho feliz — ver acima)
   implementados. Categoria Authentication segue de fora, sem uso hoje.
