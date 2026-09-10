-- ============================================================
-- Migration: 0040_formulario_whatsapp.sql
-- O formulário termina levando a pessoa para a conversa.
--
-- Cadastrar pela landing e parar por aí deixa o contato fora do único canal
-- onde a central funciona: o cadastro existe, mas nunca houve mensagem — e sem
-- mensagem recebida não há janela de 24h nem conversa iniciada. O caminho
-- natural é a própria pessoa abrir a conversa logo depois de se cadastrar
-- (click-to-WhatsApp), com o texto já preenchido.
--
-- Por que o texto é configurável e não fixo: ele precisa bater com uma
-- palavra-chave cadastrada na automação daquele número ("menu", "shows"). Se
-- ficasse no código, mudar a palavra no painel quebraria a landing em silêncio.
-- ============================================================

alter table formularios_cadastro
  add column whatsapp_numero   text,
  add column whatsapp_mensagem text;

comment on column formularios_cadastro.whatsapp_numero is
  'Número que a pessoa abre depois de se cadastrar (click-to-WhatsApp). Vazio esconde o botão. Guardado como veio; só dígitos ao montar o link.';
comment on column formularios_cadastro.whatsapp_mensagem is
  'Texto já preenchido na conversa. Deve bater com uma palavra-chave da automação do número — por isso é configurável, não fixo no código.';
