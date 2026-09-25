-- Cabeçalho de mídia (IMAGE/VIDEO/DOCUMENT) em campanha.
--
-- A Cloud API aceita a mídia por LINK no parâmetro do cabeçalho; a Meta baixa
-- a URL no momento do envio. O link é da campanha (igual para todos os
-- destinatários), então mora aqui e não em campaign_recipients.
--
-- Nullable de propósito: só template com cabeçalho de mídia usa. A guarda de
-- "template exige mídia mas a campanha não tem URL" fica no POST /api/campaigns
-- e no campaign-sender — sem ela a Meta recusaria 100% dos envios.
alter table campaigns add column if not exists header_media_url text;
