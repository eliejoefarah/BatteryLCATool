-- =============================================================================
-- 017_bw_mapping_selection_extend.sql  —  Battery LCA Tool
-- =============================================================================
-- Extends bw_mapping_selection with the columns needed to store a confirmed
-- Brightway background mapping, including a link to the bw_activity_catalog
-- entry (016_bw_activity_catalog.sql) and a full denormalised snapshot of the
-- chosen activity so the mapping is self-contained even if the catalog is
-- later updated.
--
-- NOTE: 013 was already taken by 013_add_infrastructure_kind.sql.
--       This migration is numbered 017 to maintain strict filename ordering
--       and to run after 016_bw_activity_catalog.sql (which creates the
--       bw_activity_catalog table referenced by bw_catalog_id).
--
-- Idempotency: every column is added with ADD COLUMN IF NOT EXISTS; the
-- DELETE policy guard uses a DO $$ block to check pg_policies before creating.
-- =============================================================================


-- =============================================================================
-- 1. New columns on bw_mapping_selection
-- =============================================================================
-- confirmed_by and confirmed_at already exist in the original schema
-- (001_schema.sql); ADD COLUMN IF NOT EXISTS silently skips them.
-- mapping_notes is distinct from the existing `notes` column.
-- The bw_catalog_id FK references bw_activity_catalog created in 016.
-- app_user PK is user_id — confirmed_by FK uses user_id accordingly.
-- =============================================================================

ALTER TABLE bw_mapping_selection
    ADD COLUMN IF NOT EXISTS bw_catalog_id               uuid
        REFERENCES bw_activity_catalog(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS confirmed_activity_name      text,
    ADD COLUMN IF NOT EXISTS confirmed_reference_product  text,
    ADD COLUMN IF NOT EXISTS confirmed_location           text,
    ADD COLUMN IF NOT EXISTS confirmed_unit               text,
    ADD COLUMN IF NOT EXISTS confirmed_ecoinvent_version  text,
    ADD COLUMN IF NOT EXISTS confirmed_system_model       text,
    -- confirmed_by already exists as NOT NULL REFERENCES app_user(user_id)
    ADD COLUMN IF NOT EXISTS confirmed_by                 uuid
        REFERENCES app_user(user_id) ON DELETE SET NULL,
    -- confirmed_at already exists as NOT NULL DEFAULT NOW()
    ADD COLUMN IF NOT EXISTS confirmed_at                 timestamptz,
    ADD COLUMN IF NOT EXISTS mapping_notes                text;


-- =============================================================================
-- 2. RLS — SELECT / INSERT / UPDATE already created in 002_rls.sql
-- =============================================================================
-- RLS is already enabled on bw_mapping_selection (002_rls.sql line 47).
-- SELECT, INSERT, UPDATE policies already exist (002_rls.sql lines 770–816).
-- Only the DELETE policy is missing; add it idempotently via DO block.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_policies
        WHERE  schemaname = 'public'
          AND  tablename  = 'bw_mapping_selection'
          AND  policyname = 'bw_mapping_selection_delete_admin'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY bw_mapping_selection_delete_admin ON bw_mapping_selection
                FOR DELETE USING (
                    (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
                )
        $policy$;
    END IF;
END;
$$;
