ALTER TABLE public.blog_posts DROP CONSTRAINT blog_posts_status_check;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'scheduled'::text, 'rejected'::text, 'published'::text]));