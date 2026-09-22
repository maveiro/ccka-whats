# PRD: Criação de templates pela plataforma — wa-intelligence

**Data:** 22/09/2026
**Status:** proposto, não implementado

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
- **Categoria Authentication.**
- **Edição de template aprovado.** A Meta tem um endpoint de edição, mas com
  limites e restrições que valem investigar quando surgir o primeiro caso
  real. Para v1, rejeitado ou a ajustar = duplicar e reenviar com nome novo
  (`_v2`) — mesma filosofia já usada com Flow publicado (regra "armadilhas já
  pagas" do módulo de automação: o que está fixado na Meta não se edita, se
  substitui).
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

## Plano de implementação (fases)

1. `createMessageTemplate` em `graphClient.ts` + `GET /api/templates`
   (extensão da rota existente) + tela de lista, sem criação ainda —
   entrega visibilidade (rejeitado e por quê) mesmo antes do formulário.
2. Formulário completo (cabeçalho texto, corpo, rodapé, botão de URL
   rastreada) — cobre o caso de uso real de hoje (campanhas de show).
3. Botão de Flow e resposta rápida no formulário.
4. (Fora do v1, PRD próprio se necessário) cabeçalho de mídia, edição de
   template aprovado, categoria Authentication.
