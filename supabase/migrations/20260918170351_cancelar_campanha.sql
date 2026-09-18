-- ============================================================
-- Cancelar campanha.
--
-- Uma campanha pausada por teto de tier só tinha "Retomar" — quem decidiu
-- não continuar ficava sem saída, e os destinatários restantes ficavam
-- `pending` para sempre (achado pelo fundador em 18/09/2026, numa campanha
-- com 400 de 5.174 processados).
--
-- Cancelar NÃO apaga: a campanha já disparou para 400 pessoas, e esse
-- histórico — inclusive o custo no ledger — é o que explica a fatura. Por
-- isso não é o "Excluir", que existe só para rascunho.
-- ============================================================

create or replace function cancelar_campanha(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campanha   record;
  v_cancelados int;
begin
  select id, tenant_id, status into v_campanha
    from campaigns
   where id = p_campaign_id and tenant_id = my_tenant_id();

  if not found then
    raise exception 'campanha não encontrada';
  end if;

  -- Concluída ou já cancelada não volta atrás; falha idem. Cancelar o que já
  -- terminou seria reescrever história.
  if v_campanha.status not in ('draft', 'ready', 'sending', 'paused') then
    raise exception 'campanha com status % não pode ser cancelada', v_campanha.status;
  end if;

  -- Quem ainda não recebeu passa a `cancelled`, e não continua `pending`.
  -- Dois motivos: o relatório fica honesto (dá para ver quantos nunca foram
  -- enviados) e `claim_campaign_recipients` só reivindica `pending`, então
  -- nem um "Retomar" acidental nem o cron conseguem disparar o resto.
  update campaign_recipients
     set status = 'cancelled'
   where campaign_id = p_campaign_id
     and status in ('pending', 'sending');

  get diagnostics v_cancelados = row_count;

  update campaigns
     set status = 'cancelled', updated_at = now()
   where id = p_campaign_id;

  -- Contadores recalculados: `cancelled` não entra em enviados nem em
  -- falhas, então os números param de crescer sem virarem mentira.
  perform recompute_campaign_counters(p_campaign_id);

  insert into events_log (tenant_id, session_id, event_type, payload)
  values (v_campanha.tenant_id, null, 'campaign_cancelled',
          jsonb_build_object('campaignId', p_campaign_id,
                             'statusAnterior', v_campanha.status,
                             'destinatariosCancelados', v_cancelados));

  return jsonb_build_object('cancelados', v_cancelados, 'statusAnterior', v_campanha.status);
end;
$$;

comment on function cancelar_campanha is
  'Encerra a campanha e marca como cancelled quem ainda não recebeu. Não apaga histórico nem custo — para isso não existe caminho, e não deve existir.';
