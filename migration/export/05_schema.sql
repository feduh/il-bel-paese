-- Esportazione 5/5: fotografia dello schema, per confrontare il vecchio e il nuovo database.
-- Si lancia identica anche sul nuovo server: i due risultati devono coincidere.
select json_build_object(
  'tables', (select json_agg(json_build_object('table', c.relname, 'rls', c.relrowsecurity) order by c.relname)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r'),
  'columns', (select json_agg(json_build_object('t', table_name, 'c', column_name, 'type', data_type,
                'null', is_nullable, 'default', column_default) order by table_name, ordinal_position)
              from information_schema.columns where table_schema = 'public'),
  'constraints', (select json_agg(json_build_object('t', conrelid::regclass::text, 'name', conname,
                    'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname)
                  from pg_constraint where connamespace = 'public'::regnamespace),
  'indexes', (select json_agg(json_build_object('name', indexname, 'def', indexdef) order by indexname)
              from pg_indexes where schemaname = 'public'),
  'policies', (select json_agg(json_build_object('t', tablename, 'name', policyname, 'cmd', cmd,
                 'roles', roles::text, 'using', qual, 'check', with_check) order by schemaname, tablename, policyname)
               from pg_policies where schemaname in ('public', 'storage')),
  'functions', (select json_agg(json_build_object('name', p.proname,
                  'args', pg_get_function_identity_arguments(p.oid),
                  'md5', md5(pg_get_functiondef(p.oid)),
                  'secdef', p.prosecdef,
                  'anon_exec', has_function_privilege('anon', p.oid, 'execute'),
                  'auth_exec', has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname)
                from pg_proc p where p.pronamespace = 'public'::regnamespace),
  'triggers', (select json_agg(json_build_object('t', tgrelid::regclass::text, 'name', tgname,
                 'def', pg_get_triggerdef(oid), 'enabled', tgenabled) order by tgrelid::regclass::text, tgname)
               from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'storage.%'
                 and tgrelid::regclass::text not like 'auth.%'),
  'cron', (select json_agg(json_build_object('name', jobname, 'schedule', schedule, 'command', command) order by jobname)
           from cron.job),
  'enums', (select json_agg(json_build_object('type', t.typname, 'values',
              (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)) order by t.typname)
            from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e')
) as export;
