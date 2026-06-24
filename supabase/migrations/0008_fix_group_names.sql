-- Corrige grupos com nome de pessoa (pushName do remetente usado incorrectamente).
-- Regra: chat com jid @g.us cujo name NÃO contém "@g.us" E parece nome de pessoa
-- é resetado para o jid bruto. A próxima sincronização vai buscar o nome real.
--
-- "Parece nome de pessoa" = não contém espaços típicos de nomes de grupo
-- mas isso é difícil de detectar genericamente. A abordagem mais segura é
-- resetar TODOS os grupos que não tenham um nome claramente de grupo (contendo
-- palavras típicas) — mas isso é heurístico demais.
--
-- Abordagem conservadora: resetar apenas grupos onde name = push_name do
-- contato remetente (indicativo claro de contaminação pelo pushName errado).
-- Na prática: resetar grupos onde name NÃO termina em sufixo de JID e
-- o contato com esse nome existe como is_group=false.

update chats
set name = jid
where
  jid like '%@g.us'
  and name not like '%@g.us'
  and exists (
    select 1 from contacts
    where contacts.tenant_id = chats.tenant_id
      and contacts.push_name = chats.name
      and contacts.is_group = false
  );
