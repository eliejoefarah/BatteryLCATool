-- One-time setup that was done by hand in the Supabase Cloud dashboard and
-- is therefore not in supabase/migrations/. Idempotent, safe to re-run.
--
-- Run by migrate.sh as supabase_admin (owns the auth and storage schemas),
-- which prepends `\set webhook_secret '<WEBHOOK_SECRET>'` on stdin.

\set ON_ERROR_STOP on

-- ── Storage buckets ──────────────────────────────────────────────────────────
-- lca-files: raw xlsx imports (api/app/routers/import_router.py)
-- exports:   generated xlsx exports (api/app/routers/export_router.py)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lca-files', 'lca-files', false),
       ('exports',   'exports',   false)
ON CONFLICT (id) DO NOTHING;

-- web/src/pages/admin/ExportPage.tsx calls createSignedUrl on 'exports' from
-- the browser with the user's JWT, so admins need SELECT on those objects.
-- FastAPI uses the service-role key and bypasses this policy.
DROP POLICY IF EXISTS exports_admin_read ON storage.objects;
CREATE POLICY exports_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'exports'
    AND (SELECT role FROM public.app_user WHERE user_id = auth.uid()) = 'admin'
  );

-- ── on_user_created webhook ──────────────────────────────────────────────────
-- Database webhook on auth.users INSERT → on_user_created Edge Function, which
-- creates the app_user row. Same trigger the dashboard's Webhooks UI generates.
\o /dev/null
SELECT set_config('deploy.webhook_secret', :'webhook_secret', false);
\o

DO $$
BEGIN
  IF current_setting('deploy.webhook_secret') = '' THEN
    RAISE EXCEPTION 'webhook_secret is empty: run init.sql through migrate.sh';
  END IF;

  DROP TRIGGER IF EXISTS on_user_created ON auth.users;
  EXECUTE format(
    'CREATE TRIGGER on_user_created AFTER INSERT ON auth.users
       FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'http://kong:8000/functions/v1/on_user_created',
    'POST',
    json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('deploy.webhook_secret')
    )::text,
    '{}',
    '5000'
  );
END
$$;
