-- Esportazione 3/5: registro di audit (separato perché è la tabella più pesante)
select json_build_object(
  'admin_audit_log', (select coalesce(json_agg(t order by t.created_at), '[]') from public.admin_audit_log t)
) as export;
