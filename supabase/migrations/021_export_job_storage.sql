-- =============================================================================
-- 021_export_job_storage.sql  —  Battery LCA Tool
-- =============================================================================
-- 1. Adds storage-related and lifecycle columns to export_job that were absent
--    from the original schema (001_schema.sql):
--
--      file_path          TEXT          — Supabase Storage object path for the
--                                         exported file (NULL until upload done)
--      file_size_bytes    BIGINT        — byte size of the exported file
--      partner_responsible TEXT         — free-text field recording who ordered
--                                         or is responsible for this export
--      completed_at       TIMESTAMPTZ   — wall-clock timestamp when status
--                                         transitioned to 'completed' or 'failed'
--      error_message      TEXT          — human-readable failure reason; NULL on
--                                         success (complements the existing
--                                         error_log TEXT field which holds the
--                                         raw traceback)
--
--    All columns are nullable and added with ADD COLUMN IF NOT EXISTS so the
--    migration is safe to re-run against a DB that already applied it.
--
-- 2. Replaces the three export_job RLS policies from 002_rls.sql and adds a
--    missing DELETE policy, establishing the definitive access model:
--
--      SELECT  — admins always; authenticated project members via the
--                revision → battery_model → project → project_member chain
--      INSERT  — admins always; project members (export flow may create the
--                job row client-side before the FastAPI worker picks it up)
--      UPDATE  — admins always; project members (status/progress updates
--                written by the backend service role bypass RLS, but explicit
--                member UPDATE is kept for parity with import_job)
--      DELETE  — admins only (export records are audit artefacts; members
--                cannot delete them)
--
--    Existing policy names are dropped first so this migration can be applied
--    to a DB that was initialised from 002_rls.sql without conflict.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — ADD COLUMNS
-- =============================================================================

ALTER TABLE export_job
    ADD COLUMN IF NOT EXISTS file_path           TEXT,
    ADD COLUMN IF NOT EXISTS file_size_bytes     BIGINT,
    ADD COLUMN IF NOT EXISTS partner_responsible TEXT,
    ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_message       TEXT;

-- Index: fast lookup of completed exports for a given revision (common query
-- pattern in the admin export-history view).
CREATE INDEX IF NOT EXISTS idx_export_job_revision_completed
    ON export_job (revision_id, completed_at DESC NULLS LAST);


-- =============================================================================
-- SECTION 2 — RLS POLICIES
-- Replace the three policies that 002_rls.sql created and add the missing
-- DELETE policy.  All replacements use DROP … IF EXISTS so re-running is safe.
-- =============================================================================

-- Reusable CTE expression (inlined in each policy — PostgreSQL requires it):
-- revision IDs reachable by the calling user via project membership.
--
--   SELECT bmr.revision_id
--   FROM   battery_model_revision bmr
--   JOIN   battery_model bm ON bm.model_id = bmr.model_id
--   WHERE  bm.project_id IN (
--              SELECT project_id FROM project_member WHERE user_id = auth.uid()
--          )

-- ── SELECT ────────────────────────────────────────────────────────────────────
-- Admins see all rows.
-- Project members see rows belonging to their revisions.

DROP POLICY IF EXISTS export_job_select ON export_job;

CREATE POLICY export_job_select ON export_job
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM   battery_model_revision bmr
            JOIN   battery_model bm ON bm.model_id = bmr.model_id
            WHERE  bm.project_id IN (
                       SELECT project_id FROM project_member WHERE user_id = auth.uid()
                   )
        )
    );

-- ── INSERT ────────────────────────────────────────────────────────────────────
-- Admins can insert for any revision.
-- Project members can insert for their own revisions (client-side job creation).

DROP POLICY IF EXISTS export_job_insert ON export_job;

CREATE POLICY export_job_insert ON export_job
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM   battery_model_revision bmr
            JOIN   battery_model bm ON bm.model_id = bmr.model_id
            WHERE  bm.project_id IN (
                       SELECT project_id FROM project_member WHERE user_id = auth.uid()
                   )
        )
    );

-- ── UPDATE ────────────────────────────────────────────────────────────────────
-- Admins can update any row (e.g. back-filling file_path / completed_at).
-- Project members can update rows for their revisions (status progress).
-- Note: the FastAPI export worker uses the service-role key and bypasses RLS
-- entirely; this policy covers direct Supabase JS client updates.

DROP POLICY IF EXISTS export_job_update ON export_job;

CREATE POLICY export_job_update ON export_job
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM   battery_model_revision bmr
            JOIN   battery_model bm ON bm.model_id = bmr.model_id
            WHERE  bm.project_id IN (
                       SELECT project_id FROM project_member WHERE user_id = auth.uid()
                   )
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM   battery_model_revision bmr
            JOIN   battery_model bm ON bm.model_id = bmr.model_id
            WHERE  bm.project_id IN (
                       SELECT project_id FROM project_member WHERE user_id = auth.uid()
                   )
        )
    );

-- ── DELETE ────────────────────────────────────────────────────────────────────
-- Export records are audit artefacts; only admins may delete them.
-- (No matching policy existed in 002_rls.sql — this is a new addition.)

DROP POLICY IF EXISTS export_job_delete ON export_job;

CREATE POLICY export_job_delete ON export_job
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );
