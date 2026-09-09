-- ============================================================
-- Migration: 0028_flow_meta_id.sql
-- Liga um Flow nosso ao Flow publicado na Meta (Sprint B2, item 3).
--
-- Sem isto, `flow_palavras_chave.tipo_resposta='abrir_flow'` não tem como
-- funcionar: `flow_destino_id` aponta para uma linha de `whatsapp_flows`
-- (nossa), e mandar a mensagem interativa exige o ID do Flow **publicado na
-- Meta**, que não existia em lugar nenhum do schema. O primeiro envio real
-- (09/09/2026) foi feito com o ID escrito à mão num script — exatamente o que
-- esta coluna elimina.
--
-- Numeração: 0027 é a migration anterior (rótulo/artista das credenciais).
-- Os arquivos supabase/tests/0027_* e 0028_* são TESTES e não têm relação com
-- os números das migrations — a convenção se perdeu depois da 0026.
-- ============================================================

alter table whatsapp_flows
  add column meta_flow_id text,
  add column meta_flow_cta text;

comment on column whatsapp_flows.meta_flow_id is
  'ID do Flow publicado na Meta (Graph API). Só faz sentido para tipo=agenda_shows; é o que permite abrir o Flow numa conversa.';
comment on column whatsapp_flows.meta_flow_cta is
  'Texto do botão que abre o Flow na conversa (flow_cta). Cai para "Ver agenda" quando nulo.';

-- Um Flow da Meta pertence a um número; dois Flows nossos apontando para o
-- mesmo ID publicado seria erro de cadastro, não caso de uso.
create unique index whatsapp_flows_meta_flow_id_key
  on whatsapp_flows (meta_flow_id)
  where meta_flow_id is not null and deleted_at is null;
