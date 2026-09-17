-- ============================================================
-- Dimensões da arte, para a tela do fã respeitar a proporção.
--
-- Achado com a primeira arte real (17/09/2026): o banner do espetáculo é
-- 1919x819 (proporção 2.34) e a transformação do Storage, chamada só com
-- `width`, fez RECORTE CENTRAL — devolveu 800x819 e cortou o logo, metade do
-- título e o rosto da personagem. O fã viu isso.
--
-- Duas correções: `resize: contain` no sync (não recorta) e a proporção real
-- indo para o componente `Image` como `aspect-ratio` — a doc da Meta
-- recomenda informá-lo quando o `scale-type` é `contain`, senão sobra espaço
-- no Android. Com a proporção vindo do dado, qualquer formato de arte
-- (banner, quadrada, vertical) renderiza certo sem republicar o Flow.
-- ============================================================

alter table agenda_temas
  add column imagem_largura int,
  add column imagem_altura  int;

comment on column agenda_temas.imagem_largura is
  'Largura em px da imagem já reduzida (a que vai em base64). Com a altura, forma o aspect-ratio enviado ao Flow.';
