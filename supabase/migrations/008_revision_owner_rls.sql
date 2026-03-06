-- =============================================================================
-- 008_revision_owner_rls.sql — Battery LCA Tool
-- =============================================================================
-- Tighten write policies so that only the revision *creator* (or an admin)
-- can INSERT / UPDATE / DELETE processes, exchanges, parameters, and the
-- revision itself.  SELECT remains open to all project members so teammates
-- can view each other's work.
--
-- Affected tables:
--   battery_model_revision  (UPDATE)
--   model_parameter          (INSERT, UPDATE, DELETE)
--   process_instance         (INSERT, UPDATE, DELETE)
--   process_exchange         (INSERT, UPDATE, DELETE)
--   process_link             (INSERT, UPDATE, DELETE)
--   bw_mapping_selection     (INSERT, UPDATE)
-- =============================================================================


-- Helper: is the caller an admin?
-- (Inlined as a correlated sub-select to avoid cross-policy deadlocks.)

-- =============================================================================
-- battery_model_revision — UPDATE restricted to creator or admin
-- =============================================================================

DROP POLICY IF EXISTS battery_model_revision_update ON battery_model_revision;

CREATE POLICY battery_model_revision_update ON battery_model_revision
    FOR UPDATE
    USING (
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


-- =============================================================================
-- model_parameter — INSERT / UPDATE / DELETE restricted to revision creator
-- =============================================================================

DROP POLICY IF EXISTS model_parameter_insert ON model_parameter;
DROP POLICY IF EXISTS model_parameter_update ON model_parameter;
DROP POLICY IF EXISTS model_parameter_delete ON model_parameter;

CREATE POLICY model_parameter_insert ON model_parameter
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY model_parameter_update ON model_parameter
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY model_parameter_delete ON model_parameter
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- process_instance — INSERT / UPDATE / DELETE restricted to revision creator
-- =============================================================================

DROP POLICY IF EXISTS process_instance_insert ON process_instance;
DROP POLICY IF EXISTS process_instance_update ON process_instance;
DROP POLICY IF EXISTS process_instance_delete ON process_instance;

CREATE POLICY process_instance_insert ON process_instance
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_instance_update ON process_instance
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_instance_delete ON process_instance
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- process_exchange — INSERT / UPDATE / DELETE restricted to revision creator
-- (via process_instance → revision)
-- =============================================================================

DROP POLICY IF EXISTS process_exchange_insert ON process_exchange;
DROP POLICY IF EXISTS process_exchange_update ON process_exchange;
DROP POLICY IF EXISTS process_exchange_delete ON process_exchange;

CREATE POLICY process_exchange_insert ON process_exchange
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_exchange_update ON process_exchange
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_exchange_delete ON process_exchange
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- process_link — INSERT / UPDATE / DELETE restricted to revision creator
-- =============================================================================

DROP POLICY IF EXISTS process_link_insert ON process_link;
DROP POLICY IF EXISTS process_link_update ON process_link;
DROP POLICY IF EXISTS process_link_delete ON process_link;

CREATE POLICY process_link_insert ON process_link
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
        )
    );

CREATE POLICY process_link_update ON process_link
    FOR UPDATE
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
        )
    )
    WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
        )
    );

CREATE POLICY process_link_delete ON process_link
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.created_by = auth.uid()
        )
    );
