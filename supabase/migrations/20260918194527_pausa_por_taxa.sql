-- Por que a campanha pausou, onde quem disparou consegue ler.
--
-- A pausa por proteção de qualidade existia só no events_log: para quem estava
-- na tela, a campanha simplesmente parava, e o motivo virava "deu um erro"
-- (18/09/2026, campanha de 631 destinatários — foram precisos o log e uma
-- consulta para descobrir que fora a nossa própria regra que pausou).
alter table campaigns
  add column if not exists pause_reason text;

comment on column campaigns.pause_reason is
  'Motivo legível da última pausa automática. Null quando a pausa foi manual ou a campanha nunca pausou.';

-- Taxa de falha recente de uma campanha, usada para decidir a pausa
-- automática.
--
-- Substitui o gatilho antigo, que parava na PRIMEIRA recusa por proteção de
-- qualidade. A regra nasceu de uma campanha em que 76-92% dos envios falhavam
-- depois do primeiro sinal; ela não distingue isso de uma recusa por teto
-- INDIVIDUAL de marketing (erro 131049 para uma pessoa só), que é frequente e
-- inofensiva. Em 18/09/2026 isso parou uma campanha saudável 16 segundos
-- depois do disparo: 4 falhas em 100 processados, com 92% de entrega.
--
-- Contar no banco, e não no webhook, é de propósito: o webhook recebe um
-- status por vez e não tem a série; e é aqui que a regra fica visível para
-- quem for revisitar a decisão.
create or replace function taxa_de_falha_recente(
  p_campaign_id uuid,
  p_janela int default 50
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recentes as (
    select status
      from campaign_recipients
     where campaign_id = p_campaign_id
       and status in ('sent', 'delivered', 'read', 'failed')
     -- Não há `updated_at` nesta tabela: o instante do processamento é o
     -- primeiro carimbo que existir. `sent_at` cobre o caminho normal;
     -- `failed_at` cobre a recusa síncrona, que nunca chegou a ser enviada.
     order by coalesce(sent_at, failed_at, claimed_at, created_at) desc
     limit p_janela
  )
  select jsonb_build_object(
    'processados', count(*),
    'falhas', count(*) filter (where status = 'failed'),
    'taxa', case when count(*) = 0 then 0
                 else round(count(*) filter (where status = 'failed')::numeric / count(*), 4)
            end
  ) from recentes;
$$;

comment on function taxa_de_falha_recente(uuid, int) is
  'Falhas entre os últimos N destinatários já processados. Base da pausa automática por qualidade.';
