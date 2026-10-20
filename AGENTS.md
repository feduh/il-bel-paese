# Project rules

- Publishing/permission rules live in the database (RLS + triggers on blog_posts, e.g. validate_blog_post_schedule, enforce_blog_post_review_lock); the UI only mirrors them — users can call the API directly with their own token.
- Author submissions use status `scheduled` with server-set `submitted_at`; reviewers stop them via `rejected` + note. `pending` is legacy only.
- App tables keep no FK to auth.users for content (blog_posts, editorial_submissions): deleted authors are marked with `author_deleted`, so content survives deletions done outside the admin panel.
- User deletion goes through manage-user `delete_user` (ban → admin_delete_user_content RPC in one transaction → auth delete → best-effort storage cleanup) so every step is retryable and audited.
- Bulk/system jobs set `app.skip_audit` to avoid per-row audit noise; everything else is audited, including actions without auth.uid() (actor "sistema").
- Times are stored in UTC; authors pick dates in Europe/Rome via src/lib/reviewWindow.ts.
