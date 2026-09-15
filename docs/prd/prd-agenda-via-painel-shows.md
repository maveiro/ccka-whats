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

Board `18396655380` (26 | SHOWS PLAUZ, 1.021 itens) e `18427062838`
(27 | SHOWS PLAUZ, 1.460 itens) — **mesmos IDs de coluna**, por duplicação do
board. A temporada corrente é a 26; a 27 ainda não tem nada `Vendendo`.

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

4. **`artista` no board é código (`IB`), na central é nome
   (`Índio Behn - Dra. Rosangêla`).** O casamento por igualdade de texto que o
   endpoint do Flow faz (`credencial.artista = agenda.artista`) nunca casaria.
   Precisa de mapa explícito, e show de artista não mapeado **não entra** —
   entrar com o nome errado é pior que não entrar, porque não aparece para
   ninguém e não gera erro.

5. **O endpoint do Flow não filtra status.** A lista do fã filtra só
   `data_show >= now` e `artista`. Logo, o que está em `agenda_shows_sync` é o
   que o fã vê: a allowlist tem que ser aplicada **na escrita**, e o show que
   sai de `Vendendo` (cancelou, adiou, virou bloqueio) tem que **sair da
   tabela**, não apenas mudar de status.

## Fases

### Fase 1 — `painel-shows` aprende cidade, estado e hora (plauz-core)

Migration aditiva em `painel_shows.shows`: `cidade text`, `estado text`,
`hora_show time`. **Não** mexer no tipo de `data_show` (`date`): ele alimenta
`lib/signal.ts`, `lib/metrics.ts` e as views `shows_ativos` — trocar para
`timestamptz` é refatoração de raio grande por um campo que a central resolve
com uma coluna ao lado.

`lib/monday/importShows.ts` + `MondayBoardMappingForm.tsx`: dois mapeamentos
novos (`cidade_column_id`, `estado_column_id`) e a hora lida do `value` da
coluna de data (armadilha 2), não do `text`.

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

- `agenda_fontes` — por tenant: `base_url`, `token` (RLS **deny-all**, mesmo
  desenho de `whatsapp_cloud_credentials` e `internal_secrets`; token de API
  não vai para `integrations.config`, que é texto plano e já é dívida datada),
  `status_permitidos text[]` (default `{Vendendo,Esgotado}`), `ativo`.
- `agenda_artista_mapa` — `artista_origem` (`IB`) → `artista_central`
  (`Índio Behn - Dra. Rosangêla`), único por `(tenant_id, artista_origem)`.
  Sem linha, o show é ignorado e **contado** no resultado do sync.

Edge Function `agenda-sync` (+ `pg_cron`, de hora em hora): busca a API,
filtra pela allowlist e pelo mapa de artista, traduz status (`Vendendo` →
`à venda`, `Esgotado` → `esgotado`), faz upsert por
`(tenant_id, show_id_origem)` — a chave e o índice parcial **já existem** na
migration `0025` — e **apaga** as linhas com `show_id_origem` que não vieram
elegíveis nesta rodada (armadilha 5). Linha manual (`show_id_origem is null`)
nunca é tocada: é o que o índice parcial preserva de propósito.

Cada rodada grava `events_log` (`agenda_sync`) com contagens: importados,
atualizados, removidos, ignorados por artista não mapeado, ignorados por
status. Sem isso, "a agenda não atualizou" não tem como ser investigado.

UI: `/dashboard/admin/agenda` ganha o mapa de artistas, a última sincronização
e um marcador de origem por linha (Monday × manual), mais o aviso de artista
não mapeado — que é o defeito mais provável e o mais silencioso.

## O que falta (dependências, não código)

1. **Chaves do projeto Supabase do `plauz-core`** (`djipzlztvydgsfkolnej`) ou a
   conferência manual em `/admin/fontes`: não foi possível verificar se o
   import do Monday está rodando em produção, nem qual board está mapeado
   (o `.env.local` local do `painel-shows` tem valores fictícios).
2. **Autorização para trabalhar no `plauz-core`** — Fases 1 e 2 são naquele
   repo, com deploy próprio por push em `main`.
3. **Decisão de escopo por artista:** hoje a central existe para
   `Índio Behn - Dra. Rosangêla`. `DA`/`FP`/`CD` entram no mapa quando cada um
   tiver número e central próprios.
4. **Registrar a ponte como ADR no `plauz-core`** (a ADR 0006 prevê: "a próxima
   decisão necessária é só o desenho de dado específico daquele par").

## Fora de escopo

- Webhook do Monday chegando ao whats em tempo real. O `painel-shows` já tem
  webhook; a central tolera atraso de uma hora, e cron é uma peça a menos.
- `espetaculo` na tela do fã. A coluna existe nas duas pontas
  (`shows.elemento`), mas `agenda_shows_sync` não tem o campo e o Flow
  publicado não tem onde mostrá-lo — entra junto de uma revisão do Flow.
- Vendas/capacidade. É dado de gestão; a central não mostra lotação.
