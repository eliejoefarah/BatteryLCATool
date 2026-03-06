-- =============================================================================
-- 010_freeze_revision.sql — Battery LCA Tool
-- =============================================================================
-- Tightens the battery_model_revision UPDATE policy so that:
--   • Manufacturers can only UPDATE their own revision while frozen_at IS NULL.
--     This allows them to freeze a revision (set frozen_at = now()) but prevents
--     them from unfreezing it afterwards.
--   • Admins can UPDATE any revision regardless of frozen status (to unfreeze).
-- =============================================================================

DROP POLICY IF EXISTS battery_model_revision_update ON battery_model_revision;

CREATE POLICY battery_model_revision_update ON battery_model_revision
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR (
            created_by = auth.uid()
            AND frozen_at IS NULL
            AND model_id IN (
                SELECT bm.model_id FROM battery_model bm
                WHERE bm.project_id IN (
                    SELECT project_id FROM project_member WHERE user_id = auth.uid()
                )
            )
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR (
            created_by = auth.uid()
            AND model_id IN (
                SELECT bm.model_id FROM battery_model bm
                WHERE bm.project_id IN (
                    SELECT project_id FROM project_member WHERE user_id = auth.uid()
                )
            )
        )
    );
