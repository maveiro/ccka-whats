# PRD — Agenda da central alimentada pelo Monday, via painel-shows

- Status: desenho aprovado na arquitetura, aguardando dependências (ver "O que falta")
- Data: 15/09/2026
- Decorre de: `docs/prd/prd-central-de-shows.md` (a agenda que o fã vê) e da
  ADR 0006 do `plauz-core` ("Fontes de dado externas compartilhadas")

## Problema

`agenda_shows_sync` é preenchida à mão na tela `/dashboard/admin/agenda`. A
fonte de verdade dos shows é o board **26 | SHOWS PLAUZ** do Monday, que a
produção já mantém diariamente. Hoje o fã pode ver uma agenda desatualizada —
e, em 15/09/2026, vê duas linhas de teste com link de busca do Google.

## Decisão de arquitetura: ponte com o painel-shows, não Monday direto

O `painel-shows` (`plauz-core/apps/painel-shows`) **já é dono** da integração
com o Monday: app OAuth, mapeamento de colunas por board, importação em lote,
webhook de mudança de status, `painel_shows.shows.monday_item_id`.

A ADR 0006 do `plauz-core` pré-decidiu este caso: isolar por padrão, e abrir
ponte só quando **um segundo app nomeado** precisar do mesmo dado da mesma
fonte externa — na forma "registro de fonte + API interna", modo *sincroniza e
serve*, nunca proxy síncrono. O `wa-intelligence` é esse segundo consumidor.

**Proibido, e não é exceção sob prazo** (ADR 0006, regra 3): dar ao whats uma
cópia da credencial do Monday, ou um client `service_role` de um app lendo o
schema do outro. Aqui é impossível de qualquer forma — são dois projetos
Supabase distintos (`byuggqcnvezendgrcysb` × `djipzlztvydgsfkolnej`).

O custo aceito: a central não mostra nada que o `painel-shows` não saiba, e
hoje ele **não sabe cidade nem hora** (ver Fase 1). Monday direto pegaria os
dois de imediato, ao preço de um segundo mapeamento do mesmo board — que é
exatamente o que quebra em silêncio quando alguém renomeia uma coluna.

## Mapa de campos (IDs reais, verificados no board em 15/09/2026)

Board `18396655380` — **26 | SHOWS PLAUZ, o único em uso** (decisão do
fundador, 15/09/2026). O board `18427062838` (27 | SHOWS PLAUZ) existe, tem os
**mesmos IDs de coluna** por duplicação, e ainda não tem nada `Vendendo` — fica
de fora até a virada de temporada, que será uma troca de `board_id` na
configuração do `painel-shows`, não mudança de código.

| Campo da central (`agenda_shows_sync`) | Coluna no Monday | Tipo | Hoje no painel-shows |
|---|---|---|---|
| `artista` | `color_mm0h7sfh` "Artista" | status (`DA`,`FP`,`IB`,`CD`) | `shows.artista` ✅ |
| `cidade` | `lookup_mm64nxyg` "Cidade" + `lookup_mm641vp6` "Estado" | mirror | **não existe** ❌ |
| `teatro` | `board_relation_mm09nr5f` "Teatro" | board_relation | `shows.teatro` ✅ |
| `data_show` (com hora) | `date_mm0939ys` "Data" | date+time | `shows.data_show` é `date`, **sem hora** ❌ |
| `status_venda` | `color_mm09z1qc` "Status" | status | `shows.status_producao_monday` ✅ (texto cru) |
| `link_compra` | `link_mm0g116z` "Link de vendas" | link | `shows.link_vendas` ✅ |
| `show_id_origem` | id do item | — | `shows.monday_item_id` ✅ |
| (não usado hoje) | `color_mm38x6y3` "Espetáculo" | status | `shows.elemento` ✅ |

## Armadilhas verificadas (não supor de novo)

1. **Coluna espelho devolve `text` vazio.** Cidade, Estado e Teatro só vêm em
   `... on MirrorValue { display_value }` / `... on BoardRelationValue {
   display_value }`. O `painel-shows` já paga essa em
   `lib/monday/graphql.ts` (achado em produção em 11/08/2026); a mesma
   armadilha reapareceu aqui na primeira consulta.

2. **A hora vem em UTC no `value`, e o `text` vem no fuso da conta.** Item de
   14/01 às 19:30 (BRT) tem `value = {"date":"2026-01-14","time":"22:30:00"}`.
   Usar só `value.date` **erra o dia** de todo show a partir das 21h local:
   um show de 21/01 21:30 tem `value.date = 2026-01-22`. Converter sempre
   data+hora juntas, de UTC para `America/Sao_Paulo`.

3. **O board é uma agenda de produção, não uma agenda de fã.** Dos **200**
   itens futuros da temporada 26, só **77** estão `Vendendo`. Os outros 123 são
   `Bloqueio` (53), `Corporativo` (21), `Aguardando` (15), `Disponível` (12),
   `Pauta` (10), `Inviável` (4), `Cancelado`, `Confirmado`, `Negociando`,
   `Revisão`. **Nada disso pode alcançar um fã** — "Bloqueio FP" e "Eleições
   1º Turno" são linhas de calendário interno, sem teatro nem cidade.
   O filtro é allowlist de status, não "data futura".

4. **Filtro de status/artista na API do Monday exige o ÍNDICE do rótulo, não o
   texto.** `compare_value: ["Vendendo"]` devolve **zero itens, sem erro**;
   `compare_value: [2]` devolve os itens certos. Os índices do board 26 hoje:
   Status — `0` Aguardando, `1` Pauta, `2` Vendendo, `3` Finalizado,
   `4` Esgotado, `6` Bloqueio, `7` Corporativo, `8` Cancelado, `9` Adiado,
   `10` Negociando, `11` Confirmado, `12` Revisão, `13` Disponível,
   `14` Inviável; Artista — `0` DA, `1` FP, `2` IB, `3` CD. **Índice não é
   estável**: depende da ordem em que os rótulos foram criados no board, e nada
   impede alguém de criar um rótulo novo. É por isso que o filtro de uma agenda
   é guardado por **rótulo** e aplicado sobre a cópia local (ver "Filtro por
   agenda"), não como regra de `query_params` — ali o índice seria um número
   mágico no banco, e o modo de falhar é agenda vazia sem erro.

5. **`artista` no board é código (`IB`), na central é nome
   (`Índio Behn - Dra. Rosangêla`).** O casamento por igualdade de texto que o
   endpoint do Flow faz (`credencial.artista = agenda.artista`) nunca casaria.
   Precisa de mapa explícito, e show de artista não mapeado **não entra** —
   entrar com o nome errado é pior que não entrar, porque não aparece para
   ninguém e não gera erro.

6. **O endpoint do Flow não filtra status.** A lista do fã filtra só
   `data_show >= now` e `artista`. Logo, o que está em `agenda_shows_sync` é o
   que o fã vê: a allowlist tem que ser aplicada **na escrita**, e o show que
   sai de `Vendendo` (cancelou, adiou, virou bloqueio) tem que **sair da
   tabela**, não apenas mudar de status.

## Fases

### Fase 1 — REVISADA em 15/09/2026, depois de ler a produção do plauz-core

**A versão anterior desta seção estava errada** e é registrada aqui porque o
erro é instrutivo: ela dizia que "Cidade e Estado já estão sendo capturados em
`shows.dados_monday`". Isso valeria se o `painel-shows` lesse o board de shows.
Ele não lê.

O que a produção do `plauz-core` mostra (`painel_shows.fontes_config`,
`tipo='monday'`):

- o board mapeado é **`18399556790` = 📊 Marketing** (665 itens), não o
  `18396655380` (26 | SHOWS PLAUZ). O board de Marketing **espelha** campos do
  show (Artista, Data, Teatro, Status, Link de Vendas, Capacidade, Vendas) — é
  por isso que todas as colunas mapeadas são `lookup_*` e que o
  `importShows.ts` lida com espelho concatenado ("Vendendo, Vendendo");
- o board de Marketing **não tem Cidade nem Estado**, em coluna nenhuma. A
  cidade só existe dentro do nome do item
  (`elemento = "IB - 19/12/2026 - Curitiba, PR"`);
- `link_vendas_column_id`, `capacidade_column_id`, `vendas_column_id` e
  `producao_column_id` estão mapeados como **`"name"`** — e o resultado é
  `shows.link_vendas` **nulo em 100% das 276 linhas**. O link existe, mas só em
  `dados_monday['Link de Vendas']`, e só em parte dos itens;
- a última importação foi em **14/08/2026** — um mês atrás. O import é manual
  (botão "Importar do monday" em `/admin/fontes`); os crons do `vercel.json`
  são de Sympla e Meta Ads, não de Monday. Logo `status_producao_monday` é
  status de um mês atrás;
- são **276 shows**, não os 1.021 do board: só existe linha para show que tem
  item de Marketing.

### O que isso significa, em números, para a agenda do IB

| | Pelo `painel-shows` hoje | Lendo o board 26 |
|---|---|---|
| Shows futuros | 27 | 22 elegíveis (`Vendendo`/`Esgotado`) |
| Com link de compra | **0** (`link_vendas`); 11 no jsonb | 22 |
| Com cidade | **0** | 22 |
| Com horário | 0 (`data_show` é `date`) | 22 |
| Idade do status | ~1 mês | ao vivo |

Ou seja: a ponte, como o `painel-shows` está hoje, entregaria ao fã uma agenda
sem cidade, quase toda sem link e com status vencido. Não é o desenho que
falhou — é que a cópia do `painel-shows` foi construída para o dashboard de
marketing dele, não para ser espelho do board de shows.

### Fase 1 — as três saídas possíveis

1. **Repontar o `painel-shows` para o board 26.** Uma linha de configuração,
   mas muda a semântica do app inteiro: `painel_shows.shows` iria de 276 para
   ~1.021 linhas, passando a incluir bloqueio, corporativo e pauta, e
   `lib/signal.ts`/`/shows` foram construídos sobre "show que tem marketing".
   É decisão de produto **daquele** app, não desta integração.
2. **Leitor dedicado no `painel-shows`** (recomendado): tabela nova
   (`painel_shows.shows_board`, espelho fiel do board 26, com cidade, estado,
   hora e link), com cron próprio, servida pela API interna. O dashboard atual
   fica intacto, o Monday continua tendo **um único dono** (ADR 0006 mantida) e
   a agenda da central passa a ler um espelho feito para ela.
3. **Monday direto do whats.** Resolve em um dia e entrega os 22 shows
   completos, ao preço de duas credenciais e dois mapeamentos do mesmo board —
   o que a ADR 0006 chama de quebra da regra 1, não exceção.

### Fase 2 — API interna do `painel-shows`

`GET /api/interno/agenda` — read-only, autenticada por bearer de um segredo
dedicado (mesmo molde do `CRON_SECRET` que as rotas de cron já usam), sem
sessão de usuário. Serve `shows_ativos` com os campos do mapa acima:

```
{ "shows": [ { "id", "monday_item_id", "artista", "elemento", "cidade",
               "estado", "teatro", "data_show", "hora_show",
               "status_monday", "link_vendas", "updated_at" } ] }
```

Parâmetros: `desde` (default hoje) e `limit`. Sem filtro de status **na API** —
ela serve o dado da produção; quem decide o que o fã vê é o consumidor.

### Fase 3 — sync no `whats`

Tabelas novas:

- `agenda_conexoes` — uma por tenant: `base_url`, `token` do painel-shows. RLS
  **deny-all**, mesmo desenho de `whatsapp_cloud_credentials` e
  `internal_secrets`. Token de API não vai para `integrations.config`, que é
  texto plano e já é dívida datada.
- `agenda_filtros` — **uma linha por agenda**, é o que a próxima seção
  descreve.

## Filtro por agenda (decisão do fundador, 15/09/2026)

Em vez de um mapa global de artistas, cada agenda declara **como o board é
filtrado para ela**. Uma linha de `agenda_filtros` por número/central:

| Campo | Exemplo | Papel |
|---|---|---|
| `cloud_credential_id` | número do IB | a central que esta agenda alimenta (único) |
| `artista_origem` | `IB` | rótulo da coluna "Artista" no board |
| `status_permitidos` | `{Vendendo,Esgotado}` | allowlist; default no cadastro |
| `espetaculos` | `null` = todos | rótulos de "Espetáculo", quando a central é de um show só |
| `janela_dias` | `null` = todo o futuro | teto de horizonte, se algum dia fizer sentido |

**O nome do artista na central NÃO é digitado aqui.** Sai de
`whatsapp_cloud_credentials.artista` do próprio número — o mesmo valor que o
endpoint do Flow usa para filtrar a lista do fã. Digitar de novo seria criar a
chance de um typo que produz agenda vazia sem erro (armadilha 5); assim as duas
pontas leem o mesmo campo por construção.

**As opções vêm do board, não de campo livre.** A API interna expõe
`GET /api/interno/agenda/filtros`, que devolve os valores **distintos** que o
painel-shows já tem (`artista`, `status_producao_monday`, `elemento`). A tela
oferece dropdown; ninguém digita `Vendendo` errado, e não há índice de rótulo
em lugar nenhum do nosso banco (armadilha 4).

**O filtro é aplicado sobre a cópia local, não como `query_params` do Monday.**
O painel-shows importa o board inteiro de qualquer forma (só pula item sem
artista/teatro/data — o que já descarta as linhas de "Bloqueio", que não têm
teatro), então filtrar por rótulo em SQL é mais simples, não tem o problema do
índice, e não gasta uma chamada ao Monday por agenda.

### Validação do desenho contra o board real (15/09/2026)

Com o filtro `artista_origem=IB`, `status_permitidos={Vendendo,Esgotado}` e
data futura, o board 26 devolve **22 shows** — todos com cidade, teatro,
horário e link de compra: Curitiba (duas sessões no mesmo dia, 18h e 20h15),
Foz do Iguaçu, Uberlândia, Uberaba, Novo Hamburgo, Rio (duas sessões), Blumenau,
Joinville, Tubarão, São Paulo, Fortaleza, Osasco, Itu, Bauru, São Carlos,
Maceió, Recife, Natal, Porto Alegre e Curitiba de novo em dezembro, entre
"Como Ser Tóxica e Influenciar Pessoas" e "Especial de Natal".

É essa a agenda que a central passaria a mostrar — hoje ela mostra duas linhas
de teste com link de busca do Google.

**Ponto de dado a confirmar com a produção:** Fortaleza, 23/10, está com
**09:00** no board, enquanto todo o resto está entre 16h30 e 22h30 — e 09:00 é
também o horário das linhas de "Bloqueio", o que sugere ser o default de quem
não preencheu a hora. Sem convenção, o fã vê "23/10 09:00" para um show de
noite. Duas saídas: corrigir no board (preferível, o board é a fonte de
verdade), ou o sync tratar 09:00 como "hora a confirmar" — que é adivinhação e
erraria uma matinê real.

Edge Function `agenda-sync` (+ `pg_cron`, de hora em hora): busca a API e,
para cada linha de `agenda_filtros` ativa, aplica o filtro daquela agenda,
traduz status (`Vendendo` →
`à venda`, `Esgotado` → `esgotado`), faz upsert por
`(tenant_id, show_id_origem)` — a chave e o índice parcial **já existem** na
migration `0025` — e **apaga** as linhas com `show_id_origem` que não vieram
elegíveis nesta rodada (armadilha 5). Linha manual (`show_id_origem is null`)
nunca é tocada: é o que o índice parcial preserva de propósito.

Cada rodada grava `events_log` (`agenda_sync`) com contagens **por agenda**:
importados, atualizados, removidos, ignorados por status fora da allowlist, e
ignorados por não casar nenhum filtro. Sem isso, "a agenda não atualizou" não tem como ser investigado.

UI: `/dashboard/admin/agenda` ganha o cadastro de agenda (o filtro acima, em
dropdowns), a última sincronização com as contagens, e um marcador de origem
por linha (Monday × manual). Filtro que não devolveu nenhum show precisa
aparecer como **aviso na tela**, não só no log — é o defeito mais provável
(rótulo que mudou de nome no board) e o mais silencioso.

## O que falta (dependências, não código)

1. ~~Chaves do projeto Supabase do `plauz-core`~~ — resolvido em 15/09/2026:
   o Personal Access Token com que o CLI já está autenticado alcança os dois
   projetos da organização, então `supabase db query --linked` rodado de dentro
   da pasta do `plauz-core` lê a produção dele. Foi assim que os achados acima
   apareceram.
2. **Decisão da Fase 1** entre as três saídas acima — é decisão de negócio,
   não de implementação, porque a saída 1 mexe no produto de outro app e a 3
   abre mão da regra de uma credencial por fonte.
3. **Escopo por artista:** hoje só o IB tem número e central, então nasce uma
   linha de `agenda_filtros`. `DA`/`FP`/`CD` entram quando tiverem número
   próprio — cada um é uma linha nova, sem código novo.
4. **Registrar a ponte como ADR no `plauz-core`** (a ADR 0006 prevê: "a próxima
   decisão necessária é só o desenho de dado específico daquele par").

## Fora de escopo

- Webhook do Monday chegando ao whats em tempo real. O `painel-shows` já tem
  webhook; a central tolera atraso de uma hora, e cron é uma peça a menos.
- `espetaculo` na tela do fã. A coluna existe nas duas pontas
  (`shows.elemento`), mas `agenda_shows_sync` não tem o campo e o Flow
  publicado não tem onde mostrá-lo — entra junto de uma revisão do Flow.
- Vendas/capacidade. É dado de gestão; a central não mostra lotação.


## Imagem do show no Flow (levantamento de 17/09/2026)

Pedido: a tela de detalhe do show mostrar a arte do tema ("Espetáculo"), com a
imagem vindo do Monday. Tudo abaixo foi **verificado**, não suposto.

### O que o Flow aceita

- O componente `Image` do Flow JSON aceita **só base64** — URL não funciona.
- Teto recomendado de **300KB por imagem**, **JPEG ou PNG**, no máximo **3
  imagens por tela**, e **1MB** de payload total do data endpoint.
- `src` aceita valor dinâmico (`${data.imagem}`), então a imagem pode vir do
  nosso endpoint por show.
- A tela `DETALHE` hoje só tem texto e link: ganhar um `Image` exige
  **republicar o Flow na Meta** (Flow publicado é imutável). O `meta_flow_id`
  continua o mesmo — é ciclo de publicação, não de aprovação como template.
- Tema sem arte não pode quebrar a tela: manda-se o par
  `tem_imagem`/`sem_imagem`, porque a linguagem do Flow JSON não tem negação.

### O que o board tem hoje — e o que falta

- **`lookup_mm1rjveg` "Artes" não é imagem**: é link de **pasta do Google
  Drive** por show (`drive.google.com/drive/folders/...`). Exige auth do
  Drive, é pasta (não se sabe qual arquivo é a arte) e arte de divulgação tem
  tamanho de impressão, muito acima de 300KB.
- **A única coluna de arquivo é "Contrato"** (`file_mm09g9kp`), com PDFs.
- **Falta uma coluna com a arte em si.** É o único bloqueio: o mecanismo todo
  já está provado abaixo.

### Mecanismo provado (cada passo testado contra produção)

1. **Ler os arquivos de UMA coluna**: o `value` da coluna de arquivo devolve
   `{"files":[{"name","assetId","isImage","fileType"}]}` — o `isImage`
   permite pegar só imagem, e o `assetId` liga ao asset. Ler `item.assets`
   traria também os contratos, então é pela coluna.
2. **Baixar sem autenticação**: `assets(ids:[...]) { public_url }` devolve URL
   assinada da S3 (`files-monday-com.s3.amazonaws.com`). Testado:
   `200`, bytes corretos, **sem nenhum header de auth**.
3. **Redimensionar sem dependência nova**: a transformação de imagem do
   Supabase Storage está ativa neste projeto —
   `/storage/v1/render/image/authenticated/{bucket}/{path}?width=800&quality=70`
   respondeu `200` e reduziu de verdade (teste: 7.288 → 2.897 bytes com
   `width=100`). **Não** pedir `format=jpeg` (responde erro em JSON); e não
   mandar `Accept: image/webp`, senão volta webp, que o Flow não aceita.
4. Base64 do resultado fica **cacheado** na linha: reconverter a cada abertura
   de detalhe gastaria o orçamento de latência do endpoint a cada clique.

### Decisão pendente

**Qual coluna do board guarda a arte.** Duas formas servem: coluna de
**arquivo** com o JPEG/PNG anexado, ou coluna de **link** apontando direto
para um JPEG (não pasta). Vale notar o custo operacional: arte por show
significa alguém anexar o arquivo em cada show novo — show sem arte cai no
`sem_imagem` e a tela funciona, mas sem imagem. Arte por **tema** seria 14
arquivos em vez de 68 e mudaria muito menos, mas hoje não existe lugar no
board para guardá-la (a coluna "Espetáculo" é um status, não um board
ligado).
