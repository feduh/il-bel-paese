-- ===== 1. Keep posts / submissions when a user is deleted (no cascade) =====
-- The FK to auth.users is removed (app tables must not cascade from auth.users);
-- the original user id stays on the row and author_deleted marks it as orphaned.
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_user_id_fkey;
ALTER TABLE public.editorial_submissions DROP CONSTRAINT IF EXISTS editorial_submissions_author_user_id_fkey;
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS author_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.editorial_submissions ADD COLUMN IF NOT EXISTS author_deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_blog_posts_user_id ON public.blog_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_editorial_submissions_author ON public.editorial_submissions(author_user_id);

-- ===== 2. Review columns =====
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_note text,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- ===== 3. Helper functions =====
CREATE OR REPLACE FUNCTION public.is_privileged_publisher(_edition_id uuid, _special_issue_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'moderator')
    OR public.has_role(auth.uid(),'coordinatore')
    OR (_edition_id IS NOT NULL AND public.is_editor_chief_of_edition(_edition_id))
    OR (_special_issue_id IS NOT NULL AND public.can_manage_special_issue(_special_issue_id))
$$;

CREATE OR REPLACE FUNCTION public.can_review_post(_edition_id uuid, _special_issue_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'moderator')
    OR CASE
      WHEN _special_issue_id IS NOT NULL THEN public.can_manage_special_issue(_special_issue_id)
      WHEN _edition_id IS NOT NULL THEN public.is_editor_chief_of_edition(_edition_id)
      ELSE public.has_role(auth.uid(),'coordinatore')
    END
$$;

-- ===== 4. Schedule / review validation =====
CREATE OR REPLACE FUNCTION public.validate_blog_post_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_priv boolean;
  v_changed boolean;
BEGIN
  IF NEW.status NOT IN ('draft','pending','scheduled','rejected','published') THEN
    RAISE EXCEPTION 'Stato non valido: %', NEW.status;
  END IF;

  v_priv := v_uid IS NULL OR public.is_privileged_publisher(NEW.editorial_edition_id, NEW.special_issue_id);
  v_changed := TG_OP = 'INSERT'
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for;

  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at := NULL; NEW.rejected_by := NULL; NEW.rejected_at := NULL;
    IF NOT v_priv THEN NEW.rejection_note := NULL; END IF;
  ELSE
    NEW.submitted_at := OLD.submitted_at;
    NEW.rejected_by := OLD.rejected_by;
    NEW.rejected_at := OLD.rejected_at;
  END IF;

  IF NEW.status = 'rejected' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Un articolo non può essere creato già respinto.';
    END IF;
    IF OLD.status <> 'rejected' THEN
      IF OLD.status NOT IN ('scheduled','pending') THEN
        RAISE EXCEPTION 'Si può respingere solo un articolo in revisione.';
      END IF;
      IF v_uid IS NOT NULL AND NOT public.can_review_post(NEW.editorial_edition_id, NEW.special_issue_id) THEN
        RAISE EXCEPTION 'Non hai i permessi per respingere questo articolo.';
      END IF;
      IF btrim(coalesce(NEW.rejection_note,'')) = '' THEN
        RAISE EXCEPTION 'Inserisci una nota per l''autore.';
      END IF;
      NEW.rejected_by := v_uid;
      NEW.rejected_at := now();
    END IF;
    NEW.scheduled_for := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status = 'scheduled' THEN
    IF NEW.scheduled_for IS NULL THEN
      RAISE EXCEPTION 'Indica data e ora di pubblicazione.';
    END IF;
    IF v_changed AND (EXTRACT(MINUTE FROM NEW.scheduled_for)::int NOT IN (0,30)
       OR EXTRACT(SECOND FROM NEW.scheduled_for) <> 0) THEN
      RAISE EXCEPTION 'L''orario di pubblicazione deve essere allineato a slot di 30 minuti (es. 14:00 o 14:30).';
    END IF;
    IF v_priv THEN
      IF v_changed AND NEW.scheduled_for <= now() THEN
        RAISE EXCEPTION 'L''orario di pubblicazione deve essere nel futuro.';
      END IF;
      IF v_changed THEN NEW.submitted_at := NULL; END IF;
    ELSIF v_changed THEN
      NEW.submitted_at := now();
      IF NEW.scheduled_for < NEW.submitted_at + interval '24 hours' THEN
        RAISE EXCEPTION 'La data di pubblicazione deve essere almeno 24 ore dopo l''invio.';
      END IF;
      NEW.rejection_note := NULL;
      NEW.rejected_by := NULL;
      NEW.rejected_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('published','pending') AND NOT v_priv AND v_changed THEN
    RAISE EXCEPTION 'Come autore devi inviare l''articolo con una data di pubblicazione ad almeno 24 ore dall''invio.';
  END IF;

  NEW.scheduled_for := NULL;
  IF NEW.status = 'draft' THEN NEW.submitted_at := NULL; END IF;
  RETURN NEW;
END;
$$;

-- ===== 5. Lock submitted articles for authors =====
CREATE OR REPLACE FUNCTION public.enforce_blog_post_review_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_privileged_publisher(OLD.editorial_edition_id, OLD.special_issue_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.author_deleted IS DISTINCT FROM OLD.author_deleted THEN
    RAISE EXCEPTION 'Operazione non consentita.';
  END IF;

  IF OLD.status IN ('scheduled','pending','rejected') THEN
    IF NEW.status <> 'draft'
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.cover_image_url IS DISTINCT FROM OLD.cover_image_url
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.author_name IS DISTINCT FROM OLD.author_name
       OR NEW.editorial_edition_id IS DISTINCT FROM OLD.editorial_edition_id
       OR NEW.special_issue_id IS DISTINCT FROM OLD.special_issue_id
       OR NEW.podcast_url IS DISTINCT FROM OLD.podcast_url
       OR NEW.copyright_declaration IS DISTINCT FROM OLD.copyright_declaration
       OR NEW.copyright_check_status IS DISTINCT FROM OLD.copyright_check_status
       OR NEW.rejection_note IS DISTINCT FROM OLD.rejection_note THEN
      RAISE EXCEPTION 'Articolo bloccato: ritiralo in bozza per modificarlo.';
    END IF;
  ELSIF NEW.rejection_note IS DISTINCT FROM OLD.rejection_note
        AND NOT (NEW.status = 'scheduled' AND NEW.rejection_note IS NULL) THEN
    RAISE EXCEPTION 'Non puoi modificare la nota di revisione.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_blog_post_review_lock ON public.blog_posts;
CREATE TRIGGER trg_a_blog_post_review_lock
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_blog_post_review_lock();

CREATE OR REPLACE FUNCTION public.prevent_blog_post_author_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND auth.uid() IS NOT NULL THEN
    IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator')) THEN
      RAISE EXCEPTION 'Non puoi cambiare l''autore di un articolo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ===== 6. Notifications =====
CREATE OR REPLACE FUNCTION public.notify_blog_post_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_when text;
BEGIN
  IF NEW.author_deleted THEN RETURN NEW; END IF;

  IF NEW.status = 'published' AND COALESCE(OLD.status,'') <> 'published' THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.user_id, 'article_published', 'Articolo pubblicato',
      'Il tuo articolo "' || NEW.title || '" è ora online.', '/bollettino/' || NEW.slug);

  ELSIF NEW.status = 'scheduled' AND NEW.submitted_at IS NOT NULL
        AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    v_when := to_char(NEW.scheduled_for AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT DISTINCT r.uid, 'article_review', 'Articolo in revisione',
      'L''articolo "' || NEW.title || '" di ' || NEW.author_name || ' sarà pubblicato il ' || v_when ||
      ' (ora italiana) se nessuno lo respinge.',
      '/area-personale?tab=moderazione'
    FROM (
      SELECT ur.user_id AS uid FROM public.user_roles ur WHERE ur.role = 'admin'
      UNION
      SELECT e.curator_user_id FROM public.editorial_editions e
        WHERE e.id = NEW.editorial_edition_id AND public.has_role(e.curator_user_id,'editor_chief')
      UNION
      SELECT si.guest_editor_user_id FROM public.editorial_special_issues si
        WHERE si.id = NEW.special_issue_id AND public.has_role(si.guest_editor_user_id,'guest_editor')
      UNION
      SELECT e.curator_user_id FROM public.editorial_special_issues si
        JOIN public.editorial_editions e ON e.id = si.edition_id
        WHERE si.id = NEW.special_issue_id AND public.has_role(e.curator_user_id,'editor_chief')
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        WHERE ur.role = 'coordinatore' AND NEW.editorial_edition_id IS NULL AND NEW.special_issue_id IS NULL
    ) r
    WHERE r.uid IS NOT NULL AND r.uid IS DISTINCT FROM NEW.user_id;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.user_id, 'article_submitted', 'Articolo inviato',
      'Il tuo articolo "' || NEW.title || '" è in revisione e sarà pubblicato il ' || v_when || ' (ora italiana).',
      '/area-personale?tab=articoli');

  ELSIF NEW.status = 'scheduled' AND COALESCE(OLD.status,'') <> 'scheduled' THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.user_id, 'article_scheduled', 'Articolo programmato',
      'Il tuo articolo "' || NEW.title || '" è stato programmato per la pubblicazione.', '/area-personale');

  ELSIF NEW.status = 'rejected' AND COALESCE(OLD.status,'') <> 'rejected' THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.user_id, 'article_rejected', 'Articolo respinto',
      'Il tuo articolo "' || NEW.title || '" è stato fermato. Nota: ' || coalesce(NEW.rejection_note,''),
      '/area-personale/articolo/' || NEW.id || '/modifica');

  ELSIF NEW.status = 'pending' AND COALESCE(OLD.status,'') <> 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT ur.user_id, 'article_pending_review', 'Nuovo articolo da revisionare',
      'L''articolo "' || NEW.title || '" è in attesa di revisione.', '/area-personale?tab=moderazione'
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','moderator','coordinatore') AND ur.user_id <> NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ===== 7. Review queue for reviewers =====
CREATE OR REPLACE FUNCTION public.review_queue()
RETURNS SETOF public.blog_posts LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.blog_posts p
  WHERE p.status IN ('scheduled','pending')
    AND (p.submitted_at IS NOT NULL OR p.status = 'pending')
    AND public.can_review_post(p.editorial_edition_id, p.special_issue_id)
  ORDER BY p.scheduled_for NULLS FIRST
$$;

-- ===== 8. RLS policies for blog_posts =====
DROP POLICY IF EXISTS "Members create own posts with role limits" ON public.blog_posts;
CREATE POLICY "Members create own posts with role limits" ON public.blog_posts
FOR INSERT TO authenticated
WITH CHECK (
  author_deleted = false AND (
    ((auth.uid() = user_id) AND (
      has_role(auth.uid(),'admin') OR has_role(auth.uid(),'moderator') OR has_role(auth.uid(),'coordinatore')
      OR (has_role(auth.uid(),'author') AND status = 'draft')
    ))
    OR ((editorial_edition_id IS NOT NULL) AND is_editor_chief_of_edition(editorial_edition_id))
    OR ((special_issue_id IS NOT NULL) AND can_manage_special_issue(special_issue_id))
  )
);

DROP POLICY IF EXISTS "Update own non-published or staff updates all" ON public.blog_posts;
CREATE POLICY "Update own non-published or staff updates all" ON public.blog_posts
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'moderator') OR has_role(auth.uid(),'coordinatore')
  OR ((auth.uid() = user_id) AND status IN ('draft','pending','scheduled','rejected'))
  OR ((editorial_edition_id IS NOT NULL) AND is_editor_chief_of_edition(editorial_edition_id))
  OR ((special_issue_id IS NOT NULL) AND can_manage_special_issue(special_issue_id))
)
WITH CHECK (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'moderator') OR has_role(auth.uid(),'coordinatore')
  OR ((auth.uid() = user_id) AND status IN ('draft','scheduled','rejected'))
  OR ((editorial_edition_id IS NOT NULL) AND is_editor_chief_of_edition(editorial_edition_id))
  OR ((special_issue_id IS NOT NULL) AND can_manage_special_issue(special_issue_id))
);

DROP POLICY IF EXISTS "Delete own non-published or staff deletes all" ON public.blog_posts;
CREATE POLICY "Delete own non-published or staff deletes all" ON public.blog_posts
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'moderator') OR has_role(auth.uid(),'coordinatore')
  OR ((auth.uid() = user_id) AND status IN ('draft','pending','scheduled','rejected'))
);

-- ===== 9. Audit =====
CREATE OR REPLACE FUNCTION public.log_admin_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_row_id uuid;
BEGIN
  IF current_setting('app.skip_audit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_actor IS NULL THEN
    v_email := 'sistema';
  ELSE
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;
  IF TG_OP = 'DELETE' THEN v_row_id := (OLD.id)::uuid; ELSE v_row_id := (NEW.id)::uuid; END IF;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, table_name, row_id, old_data, new_data)
  VALUES (v_actor, v_email, TG_OP, TG_TABLE_NAME, v_row_id,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_scheduled_posts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE affected integer;
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true);
  WITH promoted AS (
    UPDATE public.blog_posts
    SET status = 'published', published_at = scheduled_for, scheduled_for = NULL
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= now()
    RETURNING 1
  )
  SELECT count(*)::int INTO affected FROM promoted;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_confirm_pending_realities()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE affected integer;
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true);
  WITH promoted AS (
    UPDATE public.realities r
    SET confirmed_status = 'confermato', confirmed_by = r.created_by, confirmed_at = now()
    WHERE r.confirmed_status = 'pendente'
      AND r.auto_confirm_at IS NOT NULL AND r.auto_confirm_at <= now()
      AND r.created_by IS NOT NULL
      AND (public.has_role(r.created_by,'coordinatore') OR public.has_role(r.created_by,'admin') OR public.has_role(r.created_by,'moderator'))
    RETURNING 1
  )
  SELECT count(*)::int INTO affected FROM promoted;
  RETURN affected;
END;
$$;

-- ===== 10. Cleanup when a profile disappears (also outside the panel) =====
CREATE OR REPLACE FUNCTION public.cleanup_deleted_user_refs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.blog_posts SET author_deleted = true WHERE user_id = OLD.user_id AND NOT author_deleted;
  UPDATE public.editorial_submissions SET author_deleted = true WHERE author_user_id = OLD.user_id AND NOT author_deleted;
  UPDATE public.realities SET created_by = NULL WHERE created_by = OLD.user_id;
  UPDATE public.realities SET confirmed_by = NULL WHERE confirmed_by = OLD.user_id;
  DELETE FROM public.notifications WHERE user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_cleanup_deleted_user_refs ON public.profiles;
CREATE TRIGGER trg_cleanup_deleted_user_refs
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleted_user_refs();

-- ===== 11. Admin deletion RPCs (service role only) =====
CREATE OR REPLACE FUNCTION public.admin_user_delete_preview(_target uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'posts', (SELECT count(*) FROM public.blog_posts WHERE user_id = _target AND NOT author_deleted),
    'published', (SELECT count(*) FROM public.blog_posts WHERE user_id = _target AND NOT author_deleted AND status = 'published'),
    'submissions', (SELECT count(*) FROM public.editorial_submissions WHERE author_user_id = _target AND NOT author_deleted),
    'realities', (SELECT count(*) FROM public.realities WHERE created_by = _target)
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user_content(_target uuid, _actor uuid, _mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_posts int; v_subs int; v_email text;
BEGIN
  IF _mode NOT IN ('keep','all') THEN
    RAISE EXCEPTION 'Opzione di eliminazione non valida: %', _mode;
  END IF;
  PERFORM set_config('app.skip_audit', 'on', true);

  SELECT count(*) INTO v_posts FROM public.blog_posts WHERE user_id = _target;
  SELECT count(*) INTO v_subs FROM public.editorial_submissions WHERE author_user_id = _target;

  IF _mode = 'all' THEN
    DELETE FROM public.editorial_submissions WHERE author_user_id = _target;
    DELETE FROM public.blog_posts WHERE user_id = _target;
  ELSE
    UPDATE public.blog_posts SET author_deleted = true WHERE user_id = _target;
    UPDATE public.editorial_submissions SET author_deleted = true WHERE author_user_id = _target;
  END IF;

  UPDATE public.realities SET created_by = NULL WHERE created_by = _target;
  UPDATE public.realities SET confirmed_by = NULL WHERE confirmed_by = _target;
  UPDATE public.editorial_editions SET curator_user_id = NULL WHERE curator_user_id = _target;
  UPDATE public.editorial_special_issues SET guest_editor_user_id = NULL WHERE guest_editor_user_id = _target;
  DELETE FROM public.notifications WHERE user_id = _target;
  DELETE FROM public.reality_bookmarks WHERE user_id = _target;
  DELETE FROM public.user_roles WHERE user_id = _target;

  SELECT email INTO v_email FROM auth.users WHERE id = _actor;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, table_name, row_id, old_data, new_data)
  VALUES (_actor, v_email, 'DELETE_USER', 'auth.users', _target, NULL,
    jsonb_build_object('mode', _mode, 'posts_count', v_posts, 'submissions_count', v_subs));

  RETURN jsonb_build_object('posts_count', v_posts, 'submissions_count', v_subs);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_note(_target uuid, _actor uuid, _note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, table_name, row_id, new_data)
  SELECT _actor, (SELECT email FROM auth.users WHERE id = _actor), 'DELETE_USER_NOTE', 'auth.users', _target,
         jsonb_build_object('note', _note)
$$;

-- ===== 12. Grants =====
REVOKE EXECUTE ON FUNCTION public.admin_delete_user_content(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_user_delete_preview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_audit_note(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_content(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_delete_preview(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_audit_note(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_blog_post_review_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_deleted_user_refs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.review_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_queue() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_privileged_publisher(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_review_post(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_privileged_publisher(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_post(uuid, uuid) TO authenticated;