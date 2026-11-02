-- Facoltativo: testo completo delle funzioni, per ispezionare a mano una differenza trovata con 05_schema.sql
select json_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)) as export
from pg_proc p where p.pronamespace = 'public'::regnamespace;
