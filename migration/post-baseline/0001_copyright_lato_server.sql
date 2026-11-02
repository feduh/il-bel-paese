-- Da applicare sul nuovo server DOPO baseline.sql.
--
-- La verifica copyright non usa più un servizio AI esterno. L'esito lo calcola sempre il database dalla
-- dichiarazione dell'autore: il valore di copyright_check_status inviato dal browser viene ignorato,
-- quindi non si può più "dichiarare ok" con una chiamata diretta all'API.
-- L'esenzione per i podcast vale solo se a scrivere è la redazione (admin, moderator, coordinatore),
-- non più per chiunque scelga una categoria che contiene "podcast".

CREATE OR REPLACE FUNCTION public.validate_blog_post_copyright()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d jsonb := NEW.copyright_declaration;
  v_uid uuid := auth.uid();
  v_staff boolean;
BEGIN
  -- Nessuna modifica rilevante: si lascia tutto com'è (modifiche di metadati, traduzioni, ecc.)
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.copyright_declaration IS NOT DISTINCT FROM OLD.copyright_declaration
     AND NEW.copyright_check_status IS NOT DISTINCT FROM OLD.copyright_check_status THEN
    RETURN NEW;
  END IF;

  v_staff := v_uid IS NULL
    OR public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'moderator')
    OR public.has_role(v_uid, 'coordinatore');

  IF v_staff AND NEW.category IS NOT NULL AND position('podcast' in lower(NEW.category)) > 0 THEN
    NEW.copyright_check_status := 'ok';
    NEW.copyright_check_notes := 'Podcast inserito dalla redazione';
    NEW.copyright_checked_at := coalesce(NEW.copyright_checked_at, now());
  ELSIF d IS NOT NULL
        AND coalesce(d->>'imagesOrigin', '') <> ''
        AND coalesce(d->>'textOrigin', '') <> ''
        AND coalesce((d->>'rightsConfirmed')::boolean, false) THEN
    NEW.copyright_check_status := 'ok';
    NEW.copyright_check_notes := 'Dichiarazione dell''autore';
    NEW.copyright_checked_at := CASE
      WHEN TG_OP = 'INSERT' OR NEW.copyright_declaration IS DISTINCT FROM OLD.copyright_declaration THEN now()
      ELSE OLD.copyright_checked_at END;
  ELSE
    NEW.copyright_check_status := 'pending';
    NEW.copyright_check_notes := NULL;
    NEW.copyright_checked_at := NULL;
  END IF;

  IF NEW.status IN ('published', 'scheduled', 'pending') AND NEW.copyright_check_status <> 'ok' THEN
    RAISE EXCEPTION 'Compila la dichiarazione di copyright e conferma di avere i diritti prima di inviare o programmare l''articolo.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_blog_post_copyright() FROM PUBLIC, anon, authenticated;
