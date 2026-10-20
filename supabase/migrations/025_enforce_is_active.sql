-- =============================================================================
-- 025_enforce_is_active.sql  —  Battery LCA Tool
-- =============================================================================
-- "Deactivate" in the admin Users page set app_user.is_active = false, but no
-- policy checked it: a deactivated user (or admin) kept full access.
--
-- This adds one RESTRICTIVE policy per RLS-enabled table in public. Restrictive
-- policies are ANDed with the existing (permissive) ones, so every existing
-- rule stays as it is and additionally requires the caller to be active, without
-- rewriting the ~100 existing policies (many of which inline their own admin
-- check instead of calling is_admin()).
--
-- The set_user_active Edge Function also bans the auth user in GoTrue, so they
-- can't log in or refresh a session; these policies cut off a session that is
-- still open immediately rather than when its token expires.
--
-- ensure_active_user_policies() is idempotent and is re-run by deploy/init.sql
-- on every deploy, so tables added by later migrations are covered too.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT is_active FROM public.app_user WHERE user_id = auth.uid()),
        false
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.ensure_active_user_policies()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relrowsecurity
          AND NOT EXISTS (
              SELECT 1 FROM pg_policy p
              WHERE p.polrelid = c.oid AND p.polname = 'require_active_user'
          )
    LOOP
        -- (SELECT ...) so the planner evaluates it once per query, not per row
        EXECUTE format(
            'CREATE POLICY require_active_user ON public.%I AS RESTRICTIVE
               FOR ALL TO authenticated
               USING ((SELECT public.is_active_user()))
               WITH CHECK ((SELECT public.is_active_user()))',
            t.relname
        );
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_active_user_policies() FROM PUBLIC;

SELECT public.ensure_active_user_policies();
