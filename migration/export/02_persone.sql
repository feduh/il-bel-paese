-- Esportazione 2/5: profili, ruoli e dati collegati alle persone
select json_build_object(
  'profiles',          (select coalesce(json_agg(t order by t.created_at), '[]') from public.profiles t),
  'user_roles',        (select coalesce(json_agg(t), '[]') from public.user_roles t),
  'reality_bookmarks', (select coalesce(json_agg(t), '[]') from public.reality_bookmarks t),
  'notifications',     (select coalesce(json_agg(t), '[]') from public.notifications t),
  'contact_messages',  (select coalesce(json_agg(t), '[]') from public.contact_messages t),
  'reality_reports',   (select coalesce(json_agg(t), '[]') from public.reality_reports t)
) as export;
