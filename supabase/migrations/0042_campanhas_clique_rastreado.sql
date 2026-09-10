-- ============================================================
-- Migration: 0042_campanhas_clique_rastreado.sql
-- Rastreia o clique no botão de URL de um template de campanha.
--
-- Por que precisa existir: clique em botão de URL NÃO gera webhook nenhum
-- na Cloud API (diferente do quick-reply, coberto pela 0022). O Meta expõe
-- só contagem agregada por template/dia (Template Analytics), que nunca
-- identifica o destinatário e ainda zera depois de 7 dias. Para saber QUEM
-- clicou — e poder disparar follow-up a partir disso — o link do template
-- passa a apontar para /c/{{1}} no nosso domínio, com um token por
-- destinatário, e de lá redirecionamos para o destino real.
-- ============================================================

alter table campaigns
  add column click_target_url text,   -- destino real do redirect
  add column clicked_count    int default 0;

-- click_token é gerado pelo BANCO, via default, não pela aplicação: há dois
-- caminhos de criação de destinatário (o upsert de CSV em POST /api/campaigns
-- e, no futuro, a materialização de segmento em SQL). Gerar na aplicação
-- obrigaria a duplicar a lógica e a esquecer num deles seria exatamente o
-- tipo de falha silenciosa que o CLAUDE.md já documenta.
--
-- 8 bytes = 64 bits = 16 chars hex. Não é segredo criptográfico (o token não
-- dá acesso a nada, só identifica uma linha), mas precisa ser não-enumerável
-- para que ninguém varra tokens e infle contadores alheios.
alter table campaign_recipients
  add column click_token text not null default encode(gen_random_bytes(8), 'hex'),
  add column clicked_at  timestamptz,
  add column click_count int default 0;

create unique index idx_campaign_recipients_click_token
  on campaign_recipients(click_token);

-- ============================================================
-- REGISTRO DO CLIQUE
-- Uma função só, em vez de 3 round-trips do Route Handler, por dois motivos:
-- o incremento de click_count precisa ser atômico (a mesma pessoa pode abrir
-- o link várias vezes, e read-then-write perderia contagem), e o redirect
-- tem que ser rápido — quem está do outro lado é um comprador esperando o
-- checkout abrir.
--
-- clicked_count da CAMPANHA é recalculado por count(*), nunca incrementado —
-- mesma regra já fixada em recompute_campaign_counters (0019). click_count do
-- DESTINATÁRIO é incremento de verdade, e é seguro porque acontece dentro do
-- próprio UPDATE da linha.
-- ============================================================
create or replace function register_campaign_click(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_url         text;
begin
  update campaign_recipients
     set clicked_at  = coalesce(clicked_at, now()),
         click_count = click_count + 1
   where click_token = p_token
  returning campaign_id into v_campaign_id;

  if v_campaign_id is null then
    return null;  -- token inexistente: o caller decide o fallback
  end if;

  update campaigns
     set clicked_count = (
           select count(*) from campaign_recipients
            where campaign_id = v_campaign_id and clicked_at is not null
         ),
         updated_at = now()
   where id = v_campaign_id
  returning click_target_url into v_url;

  return v_url;
end;
$$;

-- ============================================================
-- clicked_count entra no recálculo geral, senão o contador da campanha
-- regride para o valor antigo na próxima passagem do campaign-sender.
-- ============================================================
create or replace function recompute_campaign_counters(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update campaigns c set
    sent_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status in ('sent','delivered','read')),
    delivered_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status in ('delivered','read')),
    read_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status = 'read'),
    failed_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status = 'failed'),
    clicked_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and clicked_at is not null),
    updated_at = now()
  where c.id = p_campaign_id;
$$;
