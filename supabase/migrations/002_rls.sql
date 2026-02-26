-- =============================================================================
-- 002_rls.sql  —  Battery LCA Tool  —  Row Level Security
-- =============================================================================
-- Design notes:
--   • Admin check  : (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
--     The WHERE user_id = auth.uid() filter ensures the inner subquery always
--     hits the caller's own row (permitted by the *_select_own policy), so
--     there is no circular RLS evaluation on app_user.
--   • Member check : project_id IN (SELECT project_id FROM project_member
--                                   WHERE user_id = auth.uid())
--   • Revision membership check is the 3-hop chain:
--     revision → battery_model → project → project_member
--   • Frozen gate  : AND bmr.frozen_at IS NULL  (on INSERT/UPDATE/DELETE for
--     model_parameter, process_instance, process_exchange)
--   • service-role key used by FastAPI and Edge Functions bypasses RLS entirely.
-- =============================================================================


-- =============================================================================
-- ENABLE RLS ON ALL 26 TABLES
-- =============================================================================

ALTER TABLE app_user                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_set                ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_catalog               ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_catalog             ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_origin_catalog        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_catalog               ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_allowed_unit          ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rule            ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_template           ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_expected_exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE project                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member             ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_model              ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_model_revision     ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_parameter            ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_instance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_exchange           ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_link               ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_run             ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_issue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_job                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_mapping_candidate       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bw_mapping_selection       ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_job                 ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 1 — app_user
-- Admins see all rows; every user sees only their own row.
-- Only admins can INSERT / UPDATE / DELETE.
-- =============================================================================

CREATE POLICY app_user_select_own ON app_user
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY app_user_select_admin ON app_user
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY app_user_insert_admin ON app_user
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY app_user_update_admin ON app_user
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY app_user_delete_admin ON app_user
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );


-- =============================================================================
-- SECTION 2 — project
-- Admins see all projects.
-- Members see projects they have been assigned to via project_member.
-- INSERT / UPDATE / DELETE restricted to admins.
-- =============================================================================

CREATE POLICY project_select_admin ON project
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY project_select_member ON project
    FOR SELECT USING (
        project_id IN (
            SELECT project_id FROM project_member WHERE user_id = auth.uid()
        )
    );

CREATE POLICY project_insert_admin ON project
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY project_update_admin ON project
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY project_delete_admin ON project
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );


-- =============================================================================
-- SECTION 3 — project_member
-- Admins can do everything.
-- Manufacturers can only SELECT their own membership rows.
-- =============================================================================

CREATE POLICY project_member_select_admin ON project_member
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY project_member_select_own ON project_member
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY project_member_insert_admin ON project_member
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY project_member_update_admin ON project_member
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY project_member_delete_admin ON project_member
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );


-- =============================================================================
-- SECTION 4 — battery_model
-- Scoped to projects the user is a member of.
-- Admins see all.
-- =============================================================================

CREATE POLICY battery_model_select ON battery_model
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR project_id IN (
            SELECT project_id FROM project_member WHERE user_id = auth.uid()
        )
    );

CREATE POLICY battery_model_insert ON battery_model
    FOR INSERT WITH CHECK (
        project_id IN (
            SELECT project_id FROM project_member WHERE user_id = auth.uid()
        )
    );

CREATE POLICY battery_model_update ON battery_model
    FOR UPDATE
    USING (
        project_id IN (
            SELECT project_id FROM project_member WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        project_id IN (
            SELECT project_id FROM project_member WHERE user_id = auth.uid()
        )
    );


-- =============================================================================
-- SECTION 5 — battery_model_revision
-- Scoped via model → project → project_member.
-- Admins see all.
-- =============================================================================

CREATE POLICY battery_model_revision_select ON battery_model_revision
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR model_id IN (
            SELECT bm.model_id FROM battery_model bm
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY battery_model_revision_insert ON battery_model_revision
    FOR INSERT WITH CHECK (
        model_id IN (
            SELECT bm.model_id FROM battery_model bm
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY battery_model_revision_update ON battery_model_revision
    FOR UPDATE
    USING (
        model_id IN (
            SELECT bm.model_id FROM battery_model bm
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        model_id IN (
            SELECT bm.model_id FROM battery_model bm
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 6 — model_parameter
-- Scoped via revision → model → project → project_member.
-- INSERT / UPDATE / DELETE blocked when the revision is frozen (frozen_at IS NOT NULL).
-- =============================================================================

-- Reusable inline: revision IDs the user can read
-- (used in SELECT; no frozen-at filter)
CREATE POLICY model_parameter_select ON model_parameter
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY model_parameter_insert ON model_parameter
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY model_parameter_update ON model_parameter
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY model_parameter_delete ON model_parameter
    FOR DELETE USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- SECTION 7 — process_instance
-- Scoped via revision → model → project → project_member.
-- INSERT / UPDATE / DELETE blocked when the revision is frozen.
-- =============================================================================

CREATE POLICY process_instance_select ON process_instance
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY process_instance_insert ON process_instance
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_instance_update ON process_instance
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_instance_delete ON process_instance
    FOR DELETE USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- SECTION 8 — process_exchange
-- Scoped via process_instance → revision → model → project → project_member.
-- INSERT / UPDATE / DELETE blocked when the parent revision is frozen.
-- =============================================================================

CREATE POLICY process_exchange_select ON process_exchange
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY process_exchange_insert ON process_exchange
    FOR INSERT WITH CHECK (
        process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_exchange_update ON process_exchange
    FOR UPDATE
    USING (
        process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    )
    WITH CHECK (
        process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );

CREATE POLICY process_exchange_delete ON process_exchange
    FOR DELETE USING (
        process_id IN (
            SELECT pi.process_id
            FROM process_instance pi
            JOIN battery_model_revision bmr ON bmr.revision_id = pi.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
            AND bmr.frozen_at IS NULL
        )
    );


-- =============================================================================
-- SECTION 9 — process_link
-- Scoped via revision → model → project → project_member.
-- =============================================================================

CREATE POLICY process_link_select ON process_link
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY process_link_insert ON process_link
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY process_link_update ON process_link
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY process_link_delete ON process_link
    FOR DELETE USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 10 — artifact
-- Scoped via revision → model → project → project_member.
-- INSERT only (files are never updated or deleted by users; service-role handles removal).
-- =============================================================================

CREATE POLICY artifact_select ON artifact
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY artifact_insert ON artifact
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 11 — import_job
-- Scoped via revision → model → project → project_member.
-- UPDATE is needed so the FastAPI parser (service-role) can update status fields.
-- Users can INSERT (frontend creates the row before upload) and see their own jobs.
-- =============================================================================

CREATE POLICY import_job_select ON import_job
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY import_job_insert ON import_job
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY import_job_update ON import_job
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 12 — validation_run
-- Scoped via revision → model → project → project_member.
-- =============================================================================

CREATE POLICY validation_run_select ON validation_run
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY validation_run_insert ON validation_run
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY validation_run_update ON validation_run
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 13 — validation_issue
-- 4-hop chain: issue → validation_run → revision → model → project → member.
-- =============================================================================

CREATE POLICY validation_issue_select ON validation_issue
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR validation_id IN (
            SELECT vr.validation_id
            FROM validation_run vr
            JOIN battery_model_revision bmr ON bmr.revision_id = vr.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY validation_issue_insert ON validation_issue
    FOR INSERT WITH CHECK (
        validation_id IN (
            SELECT vr.validation_id
            FROM validation_run vr
            JOIN battery_model_revision bmr ON bmr.revision_id = vr.revision_id
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 14 — mapping_job
-- Scoped via revision → model → project → project_member.
-- =============================================================================

CREATE POLICY mapping_job_select ON mapping_job
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY mapping_job_insert ON mapping_job
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY mapping_job_update ON mapping_job
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 15 — bw_mapping_candidate
-- Candidates link to flow_catalog (shared across all projects), not to a
-- specific revision. Any authenticated project member can read all candidates.
-- INSERT is performed by FastAPI with the service-role key; admin-only via JWT.
-- =============================================================================

CREATE POLICY bw_mapping_candidate_select ON bw_mapping_candidate
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR EXISTS (
            SELECT 1 FROM project_member WHERE user_id = auth.uid()
        )
    );

CREATE POLICY bw_mapping_candidate_insert_admin ON bw_mapping_candidate
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );


-- =============================================================================
-- SECTION 16 — bw_mapping_selection
-- Scoped via revision → model → project → project_member.
-- Foulan (manufacturer) INSERT and UPDATE his own confirmed choices.
-- =============================================================================

CREATE POLICY bw_mapping_selection_select ON bw_mapping_selection
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY bw_mapping_selection_insert ON bw_mapping_selection
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY bw_mapping_selection_update ON bw_mapping_selection
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 17 — export_job
-- Scoped via revision → model → project → project_member.
-- =============================================================================

CREATE POLICY export_job_select ON export_job
    FOR SELECT USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
        OR revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY export_job_insert ON export_job
    FOR INSERT WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY export_job_update ON export_job
    FOR UPDATE
    USING (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        revision_id IN (
            SELECT bmr.revision_id
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            WHERE bm.project_id IN (
                SELECT project_id FROM project_member WHERE user_id = auth.uid()
            )
        )
    );


-- =============================================================================
-- SECTION 18 — CONFIGURATION TABLES (9 tables)
-- All authenticated users can SELECT.
-- Only admins can INSERT / UPDATE / DELETE.
-- Tables: catalog_set, unit_catalog, region_catalog, data_origin_catalog,
--         flow_catalog, flow_allowed_unit, validation_rule,
--         process_template, template_expected_exchange
-- =============================================================================

-- ── catalog_set ──────────────────────────────────────────────────────────────

CREATE POLICY catalog_set_select ON catalog_set
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY catalog_set_insert_admin ON catalog_set
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY catalog_set_update_admin ON catalog_set
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY catalog_set_delete_admin ON catalog_set
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── unit_catalog ──────────────────────────────────────────────────────────────

CREATE POLICY unit_catalog_select ON unit_catalog
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY unit_catalog_insert_admin ON unit_catalog
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY unit_catalog_update_admin ON unit_catalog
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY unit_catalog_delete_admin ON unit_catalog
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── region_catalog ────────────────────────────────────────────────────────────

CREATE POLICY region_catalog_select ON region_catalog
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY region_catalog_insert_admin ON region_catalog
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY region_catalog_update_admin ON region_catalog
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY region_catalog_delete_admin ON region_catalog
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── data_origin_catalog ───────────────────────────────────────────────────────

CREATE POLICY data_origin_catalog_select ON data_origin_catalog
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY data_origin_catalog_insert_admin ON data_origin_catalog
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY data_origin_catalog_update_admin ON data_origin_catalog
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY data_origin_catalog_delete_admin ON data_origin_catalog
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── flow_catalog ──────────────────────────────────────────────────────────────
-- Note: create-flow Edge Function runs with service-role key, so manufacturer
-- auto-creation of flows bypasses these policies by design.

CREATE POLICY flow_catalog_select ON flow_catalog
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY flow_catalog_insert_admin ON flow_catalog
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY flow_catalog_update_admin ON flow_catalog
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY flow_catalog_delete_admin ON flow_catalog
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── flow_allowed_unit ─────────────────────────────────────────────────────────

CREATE POLICY flow_allowed_unit_select ON flow_allowed_unit
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY flow_allowed_unit_insert_admin ON flow_allowed_unit
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY flow_allowed_unit_update_admin ON flow_allowed_unit
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY flow_allowed_unit_delete_admin ON flow_allowed_unit
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── validation_rule ───────────────────────────────────────────────────────────

CREATE POLICY validation_rule_select ON validation_rule
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY validation_rule_insert_admin ON validation_rule
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY validation_rule_update_admin ON validation_rule
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY validation_rule_delete_admin ON validation_rule
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── process_template ─────────────────────────────────────────────────────────

CREATE POLICY process_template_select ON process_template
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY process_template_insert_admin ON process_template
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY process_template_update_admin ON process_template
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY process_template_delete_admin ON process_template
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

-- ── template_expected_exchange ────────────────────────────────────────────────

CREATE POLICY template_expected_exchange_select ON template_expected_exchange
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY template_expected_exchange_insert_admin ON template_expected_exchange
    FOR INSERT WITH CHECK (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );

CREATE POLICY template_expected_exchange_update_admin ON template_expected_exchange
    FOR UPDATE
    USING      ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin')
    WITH CHECK ((SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin');

CREATE POLICY template_expected_exchange_delete_admin ON template_expected_exchange
    FOR DELETE USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );
