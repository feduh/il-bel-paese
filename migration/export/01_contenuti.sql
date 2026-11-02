-- Esportazione 1/5: mappa e contenuti editoriali (una riga, un oggetto JSON per tabella)
select json_build_object(
  'realities',               (select coalesce(json_agg(t order by t.created_at), '[]') from public.realities t),
  'reality_tags',            (select coalesce(json_agg(t), '[]') from public.reality_tags t),
  'reality_images',          (select coalesce(json_agg(t), '[]') from public.reality_images t),
  'blog_posts',              (select coalesce(json_agg(t order by t.created_at), '[]') from public.blog_posts t),
  'editorial_editions',      (select coalesce(json_agg(t), '[]') from public.editorial_editions t),
  'editorial_special_issues',(select coalesce(json_agg(t), '[]') from public.editorial_special_issues t),
  'editorial_submissions',   (select coalesce(json_agg(t), '[]') from public.editorial_submissions t)
) as export;
