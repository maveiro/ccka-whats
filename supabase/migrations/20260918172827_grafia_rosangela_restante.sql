-- Continuação da correção de grafia: a migration anterior pegou quatro
-- tabelas e DEIXOU DUAS — `faq_itens.artista` e `formularios_cadastro.artista`
-- também são chave de junção pelo nome do artista, não só as quatro primeiras.
--
-- Consequência real, entre 17:20 e 17:35 de 18/09/2026: o `flow-endpoint`
-- filtra a FAQ por `artista.eq.<credencial> or artista.is.null`; com a
-- credencial já corrigida e os itens não, a tela de dúvidas da central
-- respondeu VAZIA — sem erro, exatamente o modo de falha que o comentário
-- daquele trecho descreve para outro motivo (aspas no `or`).
--
-- Lição embutida no jeito de escrever este arquivo: em vez de listar as
-- tabelas que eu lembro, varrer TODA coluna `artista` do schema público, e
-- trocar a grafia nos textos livres por `replace`, que não depende de o valor
-- ser exatamente igual.

do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'artista'
       and data_type in ('text', 'character varying')
  loop
    execute format(
      'update public.%I set artista = replace(artista, %L, %L) where artista like %L',
      t.table_name, 'Rosangêla', 'Rosângela', '%Rosangêla%');
  end loop;
end $$;

-- Textos que o fã lê (o balão que oferece a central trazia o nome errado).
update whatsapp_flows
   set mensagem_convite   = replace(mensagem_convite,   'Rosangêla', 'Rosângela'),
       mensagem_boas_vindas = replace(mensagem_boas_vindas, 'Rosangêla', 'Rosângela'),
       mensagem_fallback  = replace(mensagem_fallback,  'Rosangêla', 'Rosângela'),
       texto_consentimento = replace(texto_consentimento, 'Rosangêla', 'Rosângela')
 where coalesce(mensagem_convite, '')     like '%Rosangêla%'
    or coalesce(mensagem_boas_vindas, '') like '%Rosangêla%'
    or coalesce(mensagem_fallback, '')    like '%Rosangêla%'
    or coalesce(texto_consentimento, '')  like '%Rosangêla%';

update flow_palavras_chave
   set resposta = replace(resposta, 'Rosangêla', 'Rosângela')
 where resposta like '%Rosangêla%';

update faq_itens
   set pergunta = replace(pergunta, 'Rosangêla', 'Rosângela'),
       resposta = replace(resposta, 'Rosangêla', 'Rosângela')
 where pergunta like '%Rosangêla%' or resposta like '%Rosangêla%';

-- O conteúdo do bloco é jsonb (título, texto e url moram dentro): a troca
-- vai no texto do JSON inteiro, que é o único jeito de não depender do
-- formato de cada tipo de bloco.
update pagina_blocos
   set conteudo = replace(conteudo::text, 'Rosangêla', 'Rosângela')::jsonb
 where conteudo::text like '%Rosangêla%';

update paginas_publicas
   set titulo = replace(titulo, 'Rosangêla', 'Rosângela'),
       bio    = replace(bio,    'Rosangêla', 'Rosângela')
 where coalesce(titulo, '') like '%Rosangêla%' or coalesce(bio, '') like '%Rosangêla%';
