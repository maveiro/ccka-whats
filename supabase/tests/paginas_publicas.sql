-- ============================================================
-- Página pública do artista (migration paginas_publicas).
--
-- Cada asserção é um jeito real de perder venda ou vazar dado: link de show
-- despublicado que continua funcionando, botão de página fora do ar que
-- redireciona, contador inflado por clique repetido, e slug que gera URL
-- quebrada em um app e funcional em outro.
--
-- COMO RODAR: banco LOCAL, `npm run test:db`. Tudo em begin/rollback.
-- ============================================================

begin;

create temporary table _ids (chave text primary key, valor uuid) on commit drop;

create or replace function pg_temp.assert(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is not true then raise exception 'FALHOU: %', p_mensagem; end if;
end;
$$;

insert into tenants (name, slug) values ('Tenant pagina','tenant-pagina');
insert into _ids select 'tenant', id from tenants where slug='tenant-pagina';

insert into paginas_publicas (tenant_id, slug, artista, titulo)
select valor, 'indiobehn', 'Índio Behn - Dra. Rosangêla', 'Dra. Rosângela' from _ids where chave='tenant';
insert into _ids select 'pagina', id from paginas_publicas where slug='indiobehn';

insert into pagina_blocos (pagina_id, tenant_id, tipo, ordem, conteudo)
select p.valor, t.valor, 'link', 10, '{"rotulo":"Livro","url":"https://exemplo.invalido/livro"}'::jsonb
  from _ids p, _ids t where p.chave='pagina' and t.chave='tenant';
insert into _ids select 'bloco_link', id from pagina_blocos where conteudo->>'rotulo'='Livro';

insert into pagina_blocos (pagina_id, tenant_id, tipo, ordem, conteudo)
select p.valor, t.valor, 'agenda', 20, '{"titulo":"NOVO SHOW!"}'::jsonb
  from _ids p, _ids t where p.chave='pagina' and t.chave='tenant';
insert into _ids select 'bloco_agenda', id from pagina_blocos where tipo='agenda';

insert into agenda_shows_sync (tenant_id, artista, cidade, teatro, data_show, status_venda, link_compra, publicado)
select valor, 'Índio Behn - Dra. Rosangêla', 'Curitiba/PR', 'Teatro Bom Jesus',
       now() + interval '10 days', 'à venda', 'https://exemplo.invalido/ingresso-curitiba', true
  from _ids where chave='tenant';
insert into _ids select 'show', id from agenda_shows_sync where cidade='Curitiba/PR';

-- ============================================================
-- 1. Clique num botão de link devolve o destino e conta
-- ============================================================
do $$
declare destino text;
begin
  destino := registrar_clique_pagina((select valor from _ids where chave='bloco_link'));
  perform pg_temp.assert(
    destino = 'https://exemplo.invalido/livro',
    format('deveria devolver o destino do bloco, veio %s', destino));
  perform pg_temp.assert(
    (select cliques from pagina_blocos where id = (select valor from _ids where chave='bloco_link')) = 1,
    'o contador do bloco deveria ser 1');
end $$;

-- ============================================================
-- 2. Clique num show devolve o link daquele show
-- É o ponto da página: o link de compra vem do board, não de campo digitado.
-- ============================================================
do $$
declare destino text;
begin
  destino := registrar_clique_pagina(
    (select valor from _ids where chave='bloco_agenda'),
    (select valor from _ids where chave='show'));
  perform pg_temp.assert(
    destino = 'https://exemplo.invalido/ingresso-curitiba',
    format('deveria devolver o link do show, veio %s', destino));
  perform pg_temp.assert(
    (select show_id from pagina_cliques where show_id is not null limit 1) is not null,
    'o clique precisa registrar QUAL show foi — é o que responde "qual data vende mais"');
end $$;

-- ============================================================
-- 3. Show despublicado não redireciona mais
-- Link copiado antes da despublicação não pode continuar vendendo o que saiu
-- do ar: é a mesma curadoria da central, não duas.
-- ============================================================
do $$
declare destino text;
begin
  update agenda_shows_sync set publicado = false
   where id = (select valor from _ids where chave='show');

  destino := registrar_clique_pagina(
    (select valor from _ids where chave='bloco_agenda'),
    (select valor from _ids where chave='show'));

  perform pg_temp.assert(destino is null, 'show despublicado não pode devolver destino');

  update agenda_shows_sync set publicado = true
   where id = (select valor from _ids where chave='show');
end $$;

-- ============================================================
-- 4. Bloco escondido e página fora do ar não redirecionam
-- ============================================================
do $$
declare destino text;
begin
  update pagina_blocos set ativo = false where id = (select valor from _ids where chave='bloco_link');
  destino := registrar_clique_pagina((select valor from _ids where chave='bloco_link'));
  perform pg_temp.assert(destino is null, 'bloco escondido não pode redirecionar');
  update pagina_blocos set ativo = true where id = (select valor from _ids where chave='bloco_link');

  update paginas_publicas set ativo = false where id = (select valor from _ids where chave='pagina');
  destino := registrar_clique_pagina((select valor from _ids where chave='bloco_link'));
  perform pg_temp.assert(destino is null, 'página fora do ar não pode redirecionar nenhum botão');
  update paginas_publicas set ativo = true where id = (select valor from _ids where chave='pagina');
end $$;

-- ============================================================
-- 5. Bloco inexistente devolve null, sem estourar
-- Quem chama manda a pessoa para a home; exceção aqui viraria erro 500 na
-- cara de um comprador (mesma regra 34 do /c/).
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    registrar_clique_pagina('00000000-0000-4000-8000-000000000000') is null,
    'bloco inexistente precisa devolver null, não estourar');
end $$;

-- ============================================================
-- 6. Contador é count(*), não incremento
-- Clique repetido no mesmo botão conta como dois cliques, mas o número sai da
-- contagem das linhas — não de um `+1` que pode divergir.
-- ============================================================
do $$
declare b uuid := (select valor from _ids where chave='bloco_link');
begin
  perform registrar_clique_pagina(b);
  perform registrar_clique_pagina(b);
  perform pg_temp.assert(
    (select cliques from pagina_blocos where id=b) = (select count(*) from pagina_cliques where bloco_id=b),
    'o contador precisa bater com a contagem de linhas');
end $$;

-- ============================================================
-- 7. Nada de dado pessoal na tabela de cliques
-- Página pública é coleta que ninguém consentiu: IP e user-agent não entram.
-- ============================================================
do $$
declare proibidas int;
begin
  select count(*) into proibidas
    from information_schema.columns
   where table_name = 'pagina_cliques'
     and column_name in ('ip', 'ip_address', 'user_agent', 'telefone', 'email', 'visitante_id');
  perform pg_temp.assert(proibidas = 0, 'pagina_cliques não pode ganhar coluna de dado pessoal');
end $$;

-- ============================================================
-- 8. Slug: formato de URL, e único globalmente
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into paginas_publicas (tenant_id, slug, titulo)
    select valor, 'Com Maiúscula', 'x' from _ids where chave='tenant';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'slug com maiúscula e espaço precisa ser recusado');
end $$;

do $$
declare ok boolean := false;
begin
  -- Outro tenant, mesmo endereço: é URL pública, o conflito é real.
  insert into tenants (name, slug) values ('Outro','tenant-pagina-2');
  begin
    insert into paginas_publicas (tenant_id, slug, titulo)
    select id, 'indiobehn', 'Outro artista' from tenants where slug='tenant-pagina-2';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'slug precisa ser único GLOBALMENTE, não por tenant');
end $$;

-- ============================================================
-- 9. Apagar bloco preserva o histórico de cliques
-- ============================================================
do $$
declare antes int;
begin
  select count(*) into antes from pagina_cliques;
  delete from pagina_blocos where id = (select valor from _ids where chave='bloco_link');
  perform pg_temp.assert(
    (select count(*) from pagina_cliques) = antes,
    'remover um botão não pode apagar o histórico de quem clicou nele');
end $$;

rollback;
