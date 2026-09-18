-- Correção de grafia: "Rosangêla" → "Rosângela" (o acento é no A, não no E).
--
-- Vai numa migration, e não em três PATCH pelo painel, porque esse texto é
-- CHAVE DE JUNÇÃO: o flow-endpoint acha os shows comparando
-- `whatsapp_cloud_credentials.artista` com `agenda_shows_sync.artista` por
-- igualdade literal (regra 38c). Renomear um lado sem o outro faz a central
-- servir uma agenda vazia — sem erro nenhum, que é o pior jeito de quebrar.
-- Aqui as três tabelas mudam na mesma transação.
--
-- Em banco novo (local/CI) nenhuma linha casa e o UPDATE não faz nada: é
-- correção de dado de produção, não de schema.

update whatsapp_cloud_credentials
   set artista = 'Índio Behn - Dra. Rosângela'
 where artista = 'Índio Behn - Dra. Rosangêla';

update whatsapp_flows
   set artista = 'Índio Behn - Dra. Rosângela'
 where artista = 'Índio Behn - Dra. Rosangêla';

update agenda_shows_sync
   set artista = 'Índio Behn - Dra. Rosângela'
 where artista = 'Índio Behn - Dra. Rosangêla';

update paginas_publicas
   set artista = 'Índio Behn - Dra. Rosângela'
 where artista = 'Índio Behn - Dra. Rosangêla';
