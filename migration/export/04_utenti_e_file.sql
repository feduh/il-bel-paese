-- Esportazione 4/5: utenti (SENZA password né token) e elenco dei file nello storage.
-- Le password non si migrano: sul nuovo server ogni utente imposta la sua con "Password dimenticata".
select json_build_object(
  'auth_users', (select coalesce(json_agg(json_build_object(
                    'id', u.id, 'email', u.email, 'created_at', u.created_at,
                    'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at,
                    'banned_until', u.banned_until) order by u.created_at), '[]')
                 from auth.users u),
  'storage_buckets', (select coalesce(json_agg(json_build_object(
                    'id', b.id, 'public', b.public, 'file_size_limit', b.file_size_limit,
                    'allowed_mime_types', b.allowed_mime_types)), '[]') from storage.buckets b),
  'storage_objects', (select coalesce(json_agg(json_build_object(
                    'bucket_id', o.bucket_id, 'name', o.name,
                    'size', o.metadata->>'size', 'mimetype', o.metadata->>'mimetype',
                    'created_at', o.created_at) order by o.bucket_id, o.name), '[]') from storage.objects o)
) as export;
