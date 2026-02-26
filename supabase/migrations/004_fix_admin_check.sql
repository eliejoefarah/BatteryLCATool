-- =============================================================================
-- 004_fix_admin_check.sql  —  Battery LCA Tool
-- Fix: infinite recursion in app_user RLS policies
-- =============================================================================
--
-- ROOT CAUSE
-- ----------
-- The three admin-scoped policies on app_user:
--
--   app_user_select_admin
--   app_user_update_admin
--   app_user_delete_admin
--
-- each contained:
--
--   (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
--
-- When any query needs to evaluate that subquery it re-enters app_user's
-- own RLS policy stack, which triggers the same subquery again.
-- PostgreSQL detects this as "infinite recursion detected in policy for
-- relation app_user" and aborts the query.
--
-- Note: the admin-check subqueries in every OTHER table's policies are
-- not affected.  Those subqueries read app_user, which triggers
-- app_user_select_own (USING user_id = auth.uid()) — a simple equality
-- check with no sub-select — and that satisfies the read without
-- entering the recursive branch.
--
-- FIX
-- ---
-- Introduce is_admin(), a SECURITY DEFINER function that reads app_user
-- with the function owner's privileges, bypassing RLS completely.
-- Replace the self-referential subquery in only the three affected
-- app_user policies with is_admin().
--
-- The admin-check subqueries in the remaining 25 tables are left as-is;
-- they are correct and non-recursive.  They may optionally be migrated to
-- is_admin() later for consistency.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1.  is_admin() — SECURITY DEFINER helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: executes with the privileges of the function owner
--   (postgres / supabase_admin), so it reads public.app_user directly
--   without triggering any RLS policy evaluation — breaking the cycle.
--
-- SET search_path = '': prevents search_path-injection attacks where a
--   malicious user creates a shadowing table in their own schema.
--
-- STABLE: result may be cached within a single statement; safe because
--   auth.uid() does not change mid-query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT role FROM public.app_user WHERE user_id = auth.uid()) = 'admin',
        FALSE          -- returns FALSE when auth.uid() is NULL or row is absent
    );
$$;


-- ---------------------------------------------------------------------------
-- 2.  Recreate the three self-referential app_user policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS app_user_select_admin ON app_user;
DROP POLICY IF EXISTS app_user_update_admin  ON app_user;
DROP POLICY IF EXISTS app_user_delete_admin  ON app_user;

-- Admins may read every user row (e.g. user-management UI).
CREATE POLICY app_user_select_admin ON app_user
    FOR SELECT
    USING (public.is_admin());

-- Admins may update any user row (e.g. toggle is_active, promote role).
CREATE POLICY app_user_update_admin ON app_user
    FOR UPDATE
    USING    (public.is_admin())
    WITH CHECK (public.is_admin());

-- Admins may delete any user record (hard-delete; normally prefer is_active = FALSE).
CREATE POLICY app_user_delete_admin ON app_user
    FOR DELETE
    USING (public.is_admin());
